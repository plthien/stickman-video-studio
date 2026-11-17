/** Read-only UI projection of persisted External ChatGPT task history. */
export interface ExternalHistoryRecord {
  id:string;revision:number;stage:'script'|'native';
  operation:'author'|'review'|'correct'|'recheck'|'media-review';
  status:'FROZEN'|'IMPORTED'|'STALE';
  mediaKind?:'voice'|'captions'|'preview'|'film';
  prompt:string|null;confirmedJson:string|null;
  findings:Array<{id:string;status:string;severity:string;target_ids:string[];requirement:string}>;
  errors:string[];integrity:'OK'|'PARTIAL'|'ERROR';
  editableIds?:string[];editablePaths?:string[];targetIds?:string[];findingIds?:string[];
  mediaTransferAttested?:boolean;
}
