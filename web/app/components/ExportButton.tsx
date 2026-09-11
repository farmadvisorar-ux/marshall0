'use client';

type Row = Record<string, unknown>;

function toCsv(rows: Row[], columns: { header: string; key: string }[]): string {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [
    columns.map((c) => escape(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => escape(row[c.key])).join(',')),
  ].join('\n');
}

export function ExportButton({
  rows,
  columns,
  filename,
  className,
}: {
  rows: Row[];
  columns: { header: string; key: string }[];
  filename: string;
  className?: string;
}) {
  const download = () => {
    const blob = new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button type="button" onClick={download} className={className}>
      Export as CSV
    </button>
  );
}
