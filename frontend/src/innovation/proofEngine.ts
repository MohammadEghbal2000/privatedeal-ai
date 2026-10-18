export type ProofCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ProofReport = {
  version: 1;
  filename: string;
  sha256: string;
  totalRows: number;
  passed: boolean;
  checks: ProofCheck[];
  diagnostics: string[];
  checkedAt: string;
  mode: "LOCAL_DEMO";
};

export type ProofRules = {
  minimumRows: number;
  requiredColumns: string[];
  uniqueColumn: string;
  emailColumn: string;
};

export const DEFAULT_RULES: ProofRules = {
  minimumRows: 100,
  requiredColumns: ["id", "email"],
  uniqueColumn: "id",
  emailColumn: "email"
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  text = text.replace(/^\uFEFF/, "");

  const addField = () => {
    row.push(field.trim());
    field = "";
    closedQuote = false;
  };

  const addRow = () => {
    if (row.some(cell => cell !== "")) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "," || ch === "\n" || ch === "\r") {
      addField();

      if (ch !== ",") {
        addRow();

        if (ch === "\r" && text[i + 1] === "\n") {
          i++;
        }
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (closedQuote && ch === " ") {
      continue;
    } else if (closedQuote || ch === '"') {
      throw new Error("Malformed CSV quoting detected.");
    } else {
      field += ch;
    }
  }

  if (quoted) {
    throw new Error("Unclosed quoted field in CSV.");
  }

  if (field !== "" || row.length > 0 || closedQuote) {
    addField();
    addRow();
  }

  return rows;
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function analyzeCSV(
  filename: string,
  text: string,
  rules: ProofRules = DEFAULT_RULES
): Promise<ProofReport> {

  if (new TextEncoder().encode(text).byteLength > 2_000_000) {
    throw new Error("File exceeds the 2 MB demo limit.");
  }

  const rows = parseCSV(text);

  if (rows.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const headers = rows[0].map(h => h.toLowerCase());
  const data = rows.slice(1);

  const diagnostics: string[] = [];

  const uniqueHeaders =
    headers.every(h => h.length > 0) &&
    new Set(headers).size === headers.length;

  const hasColumns =
    uniqueHeaders &&
    rules.requiredColumns.every(col =>
      headers.includes(col.toLowerCase())
    );

  const correctStructure = data.every(row =>
    row.length === headers.length
  );

  const idIndex = headers.indexOf(rules.uniqueColumn.toLowerCase());
  const emailIndex = headers.indexOf(rules.emailColumn.toLowerCase());

  const seenIDs = new Set<string>();
  let invalidIDs = 0;
  let invalidEmails = 0;

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  data.forEach((row, index) => {
    const rowNumber = index + 2;

    if (row.length !== headers.length && diagnostics.length < 8) {
      diagnostics.push(`Row ${rowNumber}: incorrect column count`);
    }

    if (idIndex >= 0) {
      const id = row[idIndex] ?? "";

      if (!id || seenIDs.has(id)) {
        invalidIDs++;

        if (diagnostics.length < 8) {
          diagnostics.push(`Row ${rowNumber}: missing or duplicate ID`);
        }
      }

      if (id) seenIDs.add(id);
    }

    if (emailIndex >= 0) {
      const email = row[emailIndex] ?? "";

      if (!emailPattern.test(email)) {
        invalidEmails++;

        if (diagnostics.length < 8) {
          diagnostics.push(`Row ${rowNumber}: invalid email format`);
        }
      }
    }
  });

  const checks: ProofCheck[] = [
    {
      id: "columns",
      label: "Required columns",
      passed: hasColumns,
      detail: hasColumns
        ? "Required columns found."
        : "Missing or duplicate column names."
    },
    {
      id: "rows",
      label: "Minimum record count",
      passed: data.length >= rules.minimumRows,
      detail: `${data.length} / ${rules.minimumRows} required records`
    },
    {
      id: "structure",
      label: "CSV structural integrity",
      passed: correctStructure,
      detail: correctStructure
        ? "Column counts are consistent."
        : "Some rows have an incorrect column count."
    },
    {
      id: "unique",
      label: "Unique customer IDs",
      passed: idIndex >= 0 && invalidIDs === 0,
      detail: `${invalidIDs} invalid or duplicate IDs`
    },
    {
      id: "emails",
      label: "Email format validation",
      passed: emailIndex >= 0 && invalidEmails === 0,
      detail: `${invalidEmails} invalid email formats`
    }
  ];

  return {
    version: 1,
    filename,
    sha256: await sha256(text),
    totalRows: data.length,
    passed: checks.every(check => check.passed),
    checks,
    diagnostics,
    checkedAt: new Date().toISOString(),
    mode: "LOCAL_DEMO"
  };
}
