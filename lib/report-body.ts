import { notion, text } from './notion';
import type { ReportBodyBlock } from './report-body-contracts';

type RichText = { plain_text: string };
type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};
type Content = {
  rich_text?: RichText[];
  caption?: RichText[];
  cells?: RichText[][];
  has_column_header?: boolean;
  has_row_header?: boolean;
  checked?: boolean;
};

export async function readReportBody(id: string): Promise<ReportBodyBlock[]> {
  const blocks: ReportBodyBlock[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const result: { results: Block[]; next_cursor: string | null } =
      await notion('/blocks/' + encodeURIComponent(id) + '/children?' + params);
    for (const block of result.results) {
      const content = (block[block.type] ?? {}) as Content;
      blocks.push({
        id: block.id,
        type: block.type,
        text: text(content.rich_text ?? content.caption),
        children: block.has_children ? await readReportBody(block.id) : [],
        ...(content.cells ? { cells: content.cells.map(cell => text(cell)) } : {}),
        ...(block.type === 'table' ? {
          columnHeader: content.has_column_header === true,
          rowHeader: content.has_row_header === true,
        } : {}),
        ...(block.type === 'to_do' ? { checked: content.checked === true } : {}),
      });
    }
    cursor = result.next_cursor;
  } while (cursor);
  return blocks;
}
