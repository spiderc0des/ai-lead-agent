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
  processed_at?: string | null;
  processed_by_name?: string | null;
  processed_note?: string | null;
  review_decision?: "good" | "not_good" | null;
  review_note?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
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
    const confidenceCol = columns.findIndex((c) => c.header === "Confidence") + 1;
    if (confidenceCol > 0) ws.getColumn(confidenceCol).numFmt = "0.00";
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  };

  // Whether the team has acted on each qualified lead, after the run.
  const processed = [
    {
      header: "Processed",
      width: 24,
      value: (l: WorkbookLead) =>
        l.processed_at ? `Yes${l.processed_by_name ? `, ${l.processed_by_name}` : ""}, ${l.processed_at.slice(0, 10)}` : "Not yet",
    },
    { header: "Processing note", width: 40, value: (l: WorkbookLead) => l.processed_note ?? "" },
  ];
  sheet("Qualified", qualified, "No qualified leads on this run.", [...LEAD_COLUMNS.slice(0, 3), ...processed, ...LEAD_COLUMNS.slice(3)]);
  // Concerns lead on this sheet: they are the reason each row is here, and
  // what the reviewer has to check before promoting or dropping it.
  const [company, domain, confidence, fits, concerns, ...rest] = LEAD_COLUMNS;
  // The reviewer's verdict first: it is what the sheet is for once someone
  // has worked through the queue.
  const review = [
    {
      header: "Review",
      width: 18,
      value: (l: WorkbookLead) =>
        l.review_decision === "good" ? "Good" : l.review_decision === "not_good" ? "Not good" : "Not reviewed",
    },
    { header: "Review note", width: 40, value: (l: WorkbookLead) => l.review_note ?? "" },
    {
      header: "Reviewed by",
      width: 22,
      value: (l: WorkbookLead) =>
        l.reviewed_by_name ? `${l.reviewed_by_name}${l.reviewed_at ? `, ${l.reviewed_at.slice(0, 10)}` : ""}` : "",
    },
  ];
  sheet("Needs review", needsReview, "Nothing needs review on this run.", [
    company, domain, ...review, confidence, concerns, fits, ...rest,
  ]);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
