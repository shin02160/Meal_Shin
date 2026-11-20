export type ReportBodyBlock = {
  id: string;
  type: string;
  text: string;
  children: ReportBodyBlock[];
  cells?: string[];
  columnHeader?: boolean;
  rowHeader?: boolean;
  checked?: boolean;
};
