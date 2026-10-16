/** Tool and model setup shared by the agent (index.ts) and the eval (eval.ts). */

import {
  Funnel,
  ToolRegistry,
  assetSendRecipe,
  bindWalletTools,
  paymentsRecipe,
  receiveRecipe,
  skillToolNames,
  type LLMProvider,
  type ToolSource,
} from '@kaleidorg/mind';

import {
  kaleidoswapAtomicRecipe,
  kaleidoswapPriceRecipe,
} from '@kaleidorg/mind/kaleidoswap';

import { loadSkillsDir, packagedSkillsDir } from '@kaleidorg/mind/skills';

import { McpToolSource } from '@kaleidorg/mind/mcp';
import { createOpenAICompatibleProvider } from '@kaleidorg/mind/openai';
import { createQvacProvider } from '@kaleidorg/mind/qvac';
import { MockWallet } from '@kaleidorg/mind/testing';

/** kaleido-mcp over stdio (signet by default), or an in-process fake RLN node. */
export async function createTools(opts: {
  mock: boolean;
  allow: string[];
}): Promise<{ source: ToolSource; close: () => Promise<void> }> {
  if (opts.mock) {
    const wallet = new MockWallet({
      assets: { USDT: 1_000, XAUT: 2 },
    });

    const asset = (ref: unknown) =>
      wallet.rgbAssets.find(
        (a) => a.asset_id === ref || a.ticker === String(ref).toUpperCase(),
      );

    // MockWallet speaks the wallet-contract schema;
    // add the reads kaleido-mcp also has.
    const source = bindWalletTools(
      {
        ...wallet.handlers(),

        rln_get_asset_balance: async ({ asset_id }) => {
          const a = asset(asset_id);

          if (!a) {
            throw new Error(`Unknown asset ${String(asset_id)}`);
          }

          const amount = wallet.assets[a.ticker] ?? 0;

          return {
            asset_id: a.asset_id,
            ticker: a.ticker,
            settled: amount,
            spendable: amount,
          };
        },

        rln_refresh_transfers: async () => ({
          refreshed: true,
        }),

        rln_create_rgb_invoice: async ({ asset: ref, amount }) => ({
          invoice: `rgb:~/~/~/sig/${
            asset(ref)?.asset_id ?? 'any'
          }/${String(amount ?? '')}/utxob:mock-${Date.now().toString(36)}`,
          amount,
        }),
      },
      {
        layers: ['rln'],
        includeCore: false,
        allowMissing: true,
        id: 'mock-rln',
      },
    );

    return {
      source,
      close: async () => {},
    };
  }

  const mcp = new McpToolSource({
    id: 'kaleido',
    transport: {
      kind: 'stdio',
      command: 'npx',

      // 0.4.5+: quotes carry the RGB asset ID
      // required by the swap channel check.
      args: ['-y', 'kaleido-mcp@^0.4.5'],

      env: {
        ...(process.env as Record<string, string>),
        KALEIDO_NETWORK: process.env.KALEIDO_NETWORK ?? 'signet',
      },
    },
    allow: opts.allow,
  });

  try {
    await mcp.connect();
  } catch (err) {
    // Don't leave a half-started npx child process behind.
    await mcp.close().catch(() => {});
    throw err;
  }

  return {
    source: mcp,
    close: () => mcp.close(),
  };
}

/**
 * The model: an OpenAI-compatible server when OPENAI_BASE_URL
 * is set (Ollama, LM Studio, llama.cpp, or a hosted API).
 * Otherwise, use QVAC on-device.
 */
export async function loadProvider(): Promise<{
  provider: LLMProvider;
  dispose: () => Promise<void>;
}> {
  const baseUrl = process.env.OPENAI_BASE_URL;

  if (!baseUrl) {
    // An empty MODEL="" must fall back to the default, not to "".
    return loadQvacProvider(process.env.MODEL?.trim() || undefined);
  }

  const model = process.env.OPENAI_MODEL;

  if (!model) {
    throw new Error(
      'Set OPENAI_MODEL to the model name your server knows, e.g. qwen3.5:4b',
    );
  }

  console.error(`[using ${model} at ${baseUrl}]`);

  return {
    provider: createOpenAICompatibleProvider({
      baseUrl,
      model,
      apiKey: process.env.OPENAI_API_KEY,
      defaultTemperature: 0.1,
      defaultMaxTokens: 1536,
    }),

    dispose: async () => {},
  };
}

/**
 * Load a Qwen3.5 model through @qvac/sdk.
 *
 * `model` is an @qvac/sdk catalog constant name.
 *
 * If QVAC_MODEL_PATH is set, that local .gguf file is the ONLY source:
 * no registry download and no fallback.
 *
 * Otherwise the catalog constant is used, and an optional
 * QVAC_FALLBACK_SRC environment variable can specify a matching
 * fallback URL or local file path.
 */
export async function loadQvacProvider(
  model = 'QWEN3_5_2B_MULTIMODAL_Q4_K_M',
): Promise<{ provider: LLMProvider; dispose: () => Promise<void> }> {
  const sdk = await import('@qvac/sdk');

  const modelSrc = (sdk as unknown as Record<string, unknown>)[model];

  if (!modelSrc) {
    throw new Error(`@qvac/sdk has no model constant ${model}`);
  }

  console.error(`[loading ${model}]`);

  // Local model file: when set, it replaces the registry source entirely.
  const localPath = process.env.QVAC_MODEL_PATH?.trim() || undefined;

  if (localPath) {
    console.error(`[using local model file] ${localPath}`);
  }

  // Fallback is only used when there is no local file.
  // The default URL is only for the default 2B model.
  const fallbackSrc = localPath
    ? undefined
    : process.env.QVAC_FALLBACK_SRC?.trim() ||
      (model === 'QWEN3_5_2B_MULTIMODAL_Q4_K_M'
        ? 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf'
        : undefined);

  if (fallbackSrc) {
    console.error('[QVAC fallback source configured]');
  }

  let modelId: string;
  try {
    modelId = await sdk.loadModel({
      modelSrc: (localPath ?? modelSrc) as typeof sdk.QWEN3_5_2B_MULTIMODAL_Q4_K_M,
      modelType: 'llamacpp-completion',

      ...(fallbackSrc ? { fallbackSrc } : {}),

      modelConfig: {
        ctx_size: 8192,
        tools: true,
        device: 'gpu',
        gpu_layers: 99,
      },
    });
  } catch (err) {
    // Release the SDK if the model never loaded.
    await sdk.close().catch(() => {});
    throw err;
  }

  // THINK="" or THINK="abc" would give 0 / NaN; keep the default then.
  const thinkEnv = Number.parseInt(process.env.THINK ?? '', 10);
  const maxThinkingTokens =
    Number.isFinite(thinkEnv) && thinkEnv > 0 ? thinkEnv : 128;

  return {
    provider: createQvacProvider({
      completion: sdk.completion,
      cancel: sdk.cancel,
      getModelId: () => modelId,

      // Faster tool loops; enabled only when SESSION_CACHE=1.
      sessionCache: process.env.SESSION_CACHE === '1',
      deleteCache: sdk.deleteCache,

      defaultTemperature: 0.1,
      defaultMaxTokens: 1536,

      // Qwen3.5 ignores /no_think; limit the thinking budget.
      maxThinkingTokens,
    }),

    dispose: async () => {
      try {
        await sdk.unloadModel({ modelId });
      } finally {
        // Close the SDK even if unloading fails.
        await sdk.close();
      }
    },
  };
}

/** The bundled skills. */
export const SKILLS = loadSkillsDir(packagedSkillsDir());

/**
 * kaleido-mcp tools to expose:
 * everything the RGB node and trading skills name.
 */
export const AGENT_TOOLS = [
  ...new Set(
    SKILLS.filter((s) =>
      ['rgb-lightning-node', 'kaleido-trading'].includes(s.name),
    ).flatMap(skillToolNames),
  ),
];

/**
 * The same pipeline the apps run:
 * fast path (no model) â†’ recipes (at most one model call,
 * none for explicit phrasings) â†’ skill-scoped agent.
 */
export function createFunnel(
  provider: LLMProvider,
  source: ToolSource,
): Funnel {
  return new Funnel({
    provider,
    tools: new ToolRegistry([source]),
    skills: SKILLS,

    // Price before the swap, so "BTC price" never starts one.
    recipes: [
      kaleidoswapPriceRecipe,
      kaleidoswapAtomicRecipe,
      assetSendRecipe,
      paymentsRecipe,
      receiveRecipe,
    ],

    compressToolOutput: true,
  });
}
