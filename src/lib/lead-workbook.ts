import "server-only";
import ExcelJS from "exceljs";

export type WorkbookLead = {
  company_name: string;
  company_domain: string;
  confidence: number;
  fit_reasons: string[] | null;
  concerns: string[] | null;
  source_urls: string[] | null;
  source_summary: string | null;
};

const LEAD_COLUMNS: { header: string; width: number; value: (l: WorkbookLead) => string | number }[] = [
  { header: "Company", width: 28, value: (l) => l.company_name },
  { header: "Domain", width: 24, value: (l) => l.company_domain },
  { header: "Confidence", width: 12, value: (l) => Number(l.confidence) },
  { header: "Why it fits", width: 60, value: (l) => (l.fit_reasons ?? []).map((r) => `• ${r}`).join("\n") },
  { header: "Concerns", width: 60, value: (l) => (l.concerns ?? []).map((c) => `• ${c}`).join("\n") },
  { header: "Sources", width: 40, value: (l) => (l.source_urls ?? []).join("\n") },
  { header: "Source summary", width: 60, value: (l) => l.source_summary ?? "" },
];

export async function leadWorkbook(qualified: WorkbookLead[], needsReview: WorkbookLead[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Koya Lead Agent";

  const sheet = (name: string, rows: WorkbookLead[], empty: string, columns = LEAD_COLUMNS) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    if (rows.length === 0) ws.addRow([empty]);
    for (const l of rows) ws.addRow(columns.map((c) => c.value(l)));
    ws.eachRow((row, n) => {
      if (n > 1) row.alignment = { vertical: "top", wrapText: true };
    });
    ws.getColumn(3).numFmt = "0.00";
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  };

  sheet("Qualified", qualified, "No qualified leads on this run.");
  // Concerns lead on this sheet: they are the reason each row is here, and
  // what the reviewer has to check before promoting or dropping it.
  const [company, domain, confidence, fits, concerns, ...rest] = LEAD_COLUMNS;
  sheet("Needs review", needsReview, "Nothing needs review on this run.", [
    company, domain, confidence, concerns, fits, ...rest,
  ]);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
