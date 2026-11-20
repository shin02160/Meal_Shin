import { Fragment } from 'react';
import type { ReportBodyBlock } from '../../../lib/report-body-contracts';

function BodyBlocks({ blocks }: { blocks: ReportBodyBlock[] }) {
  const elements = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      const items = [block];
      while (blocks[index + 1]?.type === block.type) items.push(blocks[++index]);
      const List = block.type === 'numbered_list_item' ? 'ol' : 'ul';
      elements.push(<List key={block.id}>{items.map(item => <li key={item.id}>
        <span className="report-copy">{item.text}</span><BodyBlocks blocks={item.children}/>
      </li>)}</List>);
    } else {
      elements.push(<BodyBlock key={block.id} block={block}/>);
    }
  }
  return <>{elements}</>;
}

function BodyBlock({ block }: { block: ReportBodyBlock }) {
  const children = <BodyBlocks blocks={block.children}/>;
  switch (block.type) {
    case 'heading_1':
    case 'heading_2':
      return <section><h3>{block.text}</h3>{children}</section>;
    case 'heading_3':
      return <section><h4>{block.text}</h4>{children}</section>;
    case 'table': {
      const rows = block.children.filter(row => row.type === 'table_row');
      const rowCells = (row: ReportBodyBlock, header = false) => (row.cells ?? []).map((cell, index) =>
        header || (block.rowHeader && index === 0)
          ? <th scope={header ? 'col' : 'row'} key={index}>{cell}</th>
          : <td key={index}>{cell}</td>);
      return <div className="report-table-scroll" role="region" aria-label="상세 분석 표" tabIndex={0}>
        <table>
          {block.columnHeader && rows[0] && <thead><tr>{rowCells(rows[0], true)}</tr></thead>}
          <tbody>{rows.slice(block.columnHeader ? 1 : 0).map(row =>
            <tr key={row.id}>{rowCells(row)}</tr>)}</tbody>
        </table>
      </div>;
    }
    case 'quote':
    case 'callout':
      return <blockquote><p className="report-copy">{block.text}</p>{children}</blockquote>;
    case 'toggle':
      return <details className="period-disclosure"><summary>{block.text}</summary>{children}</details>;
    case 'code':
      return <pre>{block.text}</pre>;
    case 'divider':
      return <hr/>;
    case 'to_do':
      return <div><p className="report-copy"><span aria-hidden="true">{block.checked ? '☑' : '☐'} </span>
        <span className="sr-only">{block.checked ? '완료' : '미완료'} </span>{block.text}</p>{children}</div>;
    default:
      return <Fragment>{block.text && <p className="report-copy">{block.text}</p>}{children}</Fragment>;
  }
}

export function ReportBody({ blocks }: { blocks: ReportBodyBlock[] }) {
  return <section className="report-body" aria-label="Notion 상세 분석">
    <h3>상세 분석</h3>
    <BodyBlocks blocks={blocks}/>
  </section>;
}
