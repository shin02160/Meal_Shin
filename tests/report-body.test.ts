import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readReportBody } from '../lib/report-body';
import type { ReportBodyBlock } from '../lib/report-body-contracts';
import { ReportBody } from '../app/review/[view]/report-body';

test('report body reads paginated root blocks and nested table rows in order', async t => {
  const previousToken = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = 'sample';
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = previousToken;
  });
  const rich = (plain_text:string) => [{plain_text}];
  const paths:string[] = [];
  global.fetch = async input => {
    const url = new URL(input.toString());
    paths.push(url.pathname);
    if (url.pathname.includes('/table/')) return Response.json({next_cursor:null,results:[
      {id:'header',type:'table_row',table_row:{cells:[rich('날짜'),rich('식단')]}},
      {id:'row',type:'table_row',table_row:{cells:[rich('11/20'),rich('샘플 식단')]}},
    ]});
    if (url.searchParams.has('start_cursor')) {
      assert.equal(url.searchParams.get('start_cursor'),'next-sample-page');
      return Response.json({next_cursor:null,results:[
        {id:'last',type:'paragraph',paragraph:{rich_text:rich('마지막 페이지 본문')}},
      ]});
    }
    return Response.json({next_cursor:'next-sample-page',results:[
      {id:'title',type:'heading_2',heading_2:{rich_text:rich('샘플 상세 분석')}},
      {id:'table',type:'table',has_children:true,table:{has_column_header:true,has_row_header:true}},
    ]});
  };
  const blocks = await readReportBody('sample-page');
  assert.deepEqual(blocks.map(block=>block.id),['title','table','last']);
  assert.equal(blocks[1].columnHeader,true);
  assert.deepEqual(blocks[1].children[1].cells,['11/20','샘플 식단']);
  assert.equal(blocks[2].text,'마지막 페이지 본문');
  assert.equal(paths.length,3);
});

test('report body preserves headings, ordered lists, table headers and escaped text', () => {
  const block = (id:string,type:string,text:string):ReportBodyBlock => ({id,type,text,children:[]});
  const html = renderToStaticMarkup(createElement(ReportBody,{blocks:[
    block('h','heading_2','샘플 분석'),
    block('a','numbered_list_item','첫 번째'),
    {...block('b','numbered_list_item','두 번째'),children:[block('nested','paragraph','중첩 설명')]},
    {...block('table','table',''),columnHeader:true,rowHeader:true,children:[
      {...block('head','table_row',''),cells:['날짜','내용']},
      {...block('row','table_row',''),cells:['11/20','<script>alert(1)</script>']},
    ]},
  ]}));
  assert.match(html,/<h3>샘플 분석<\/h3>/);
  assert.equal((html.match(/<ol>/g) ?? []).length,1);
  assert.match(html,/중첩 설명/);
  assert.match(html,/<th scope="col">날짜<\/th>/);
  assert.match(html,/<th scope="row">11\/20<\/th>/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});
