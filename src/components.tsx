import { useMemo, useState } from "react";
import type { NodeExecutionPreview, TablePreview } from "./execution";

export function resultPreviewText(preview: NodeExecutionPreview): string {
  if (preview.kind === "value") return preview.text;
  if (preview.kind === "plot") return `[PNG 图像 · base64 ${preview.plotPngBase64.length} 字符]`;
  return JSON.stringify({ columns: preview.preview.columns, rows: preview.preview.rows, totalRows: preview.preview.totalRows, totalColumns: preview.preview.totalColumns }, null, 2);
}

export function DataGrid({ preview, onExpand }: { preview: TablePreview; onExpand?: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [wrap, setWrap] = useState(false);
  const [compact, setCompact] = useState(true);
  const [copied, setCopied] = useState(false);
  const filtered = useMemo(() => {
    const token = query.trim().toLocaleLowerCase();
    const rows = token ? preview.rows.filter((row) => row.some((value) => String(value ?? "").toLocaleLowerCase().includes(token))) : [...preview.rows];
    if (!sort) return rows;
    return rows.sort((left, right) => {
      const a = left[sort.column], b = right[sort.column];
      const numeric = Number(a) - Number(b);
      const compared = Number.isNaN(numeric) ? String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true }) : numeric;
      return sort.descending ? -compared : compared;
    });
  }, [preview.rows, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const copyTable = async () => { await navigator.clipboard.writeText([preview.columns, ...filtered].map((row) => row.map((value) => String(value ?? "").replaceAll("\t", " ")).join("\t")).join("\n")); setCopied(true); window.setTimeout(() => setCopied(false), 1200); };
  return <div className={`data-grid ${wrap ? "data-grid--wrap" : ""} ${compact ? "data-grid--compact" : ""}`} onDoubleClick={onExpand}>
    <div className="data-grid__toolbar"><label className="data-grid__search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="搜索所有已载入单元格" aria-label="筛选表格"/>{query && <button aria-label="清除筛选" onClick={() => setQuery("")}>×</button>}</label><span className="data-grid__count">{filtered.length.toLocaleString()}/{preview.totalRows.toLocaleString()} 行</span><div className="data-grid__actions"><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} aria-label="每页行数"><option value={10}>10 / 页</option><option value={25}>25 / 页</option><option value={50}>50 / 页</option><option value={100}>100 / 页</option></select><button className={wrap ? "active" : ""} title="单元格自动换行" onClick={() => setWrap((value) => !value)}>↩</button><button className={compact ? "active" : ""} title="紧凑行高" onClick={() => setCompact((value) => !value)}>≡</button><button className={copied ? "copied" : ""} title="复制 TSV，可直接粘贴到 Excel" onClick={() => void copyTable()}>{copied ? "已复制 ✓" : "复制"}</button>{onExpand && <button className="data-grid__expand" onClick={onExpand}>全屏</button>}</div></div>
    <div className="data-grid__viewport"><table><thead><tr><th className="data-grid__row-number">#</th>{preview.columns.map((column, index) => <th key={`${column}-${index}`}><button onClick={() => setSort((current) => current?.column === index ? { column: index, descending: !current.descending } : { column: index, descending: false })}>{column}{sort?.column === index ? sort.descending ? " ↓" : " ↑" : ""}</button></th>)}</tr></thead><tbody>{visible.map((row, rowIndex) => <tr key={`${safePage}-${rowIndex}`}><th className="data-grid__row-number">{safePage * pageSize + rowIndex + 1}</th>{row.map((value, columnIndex) => <td key={columnIndex} title={String(value ?? "")}>{String(value ?? "")}</td>)}</tr>)}</tbody></table></div>
    <div className="data-grid__pager"><span>{preview.totalRows.toLocaleString()} 行 × {preview.totalColumns.toLocaleString()} 列{preview.rows.length < preview.totalRows ? ` · 当前载入 ${preview.rows.length.toLocaleString()} 行` : ""}</span><div><button disabled={safePage === 0} onClick={() => setPage(0)}>«</button><button disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>‹</button><b>第 {safePage + 1} / {pageCount} 页</b><button disabled={safePage + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>›</button><button disabled={safePage + 1 >= pageCount} onClick={() => setPage(pageCount - 1)}>»</button></div></div>
  </div>;
}
