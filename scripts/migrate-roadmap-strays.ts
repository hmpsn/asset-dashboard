import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('data/roadmap.json');
const raw = fs.readFileSync(filePath, 'utf-8');

let data: { sprints: Array<{ id: string; items: Array<{ status: string }> }> };
try {
  data = JSON.parse(raw);
} catch (err) {
  throw new Error(`Failed to parse ${filePath} as JSON: ${err instanceof Error ? err.message : String(err)}`);
}

const earlierIdx = data.sprints.findIndex(s => s.id === 'shipped-earlier');
const backlogIdx = data.sprints.findIndex(s => s.id === 'backlog');
if (earlierIdx === -1) throw new Error('shipped-earlier sprint not found');
if (backlogIdx === -1) throw new Error('backlog sprint not found');

const strays = data.sprints[earlierIdx].items.filter(i => i.status === 'pending');
data.sprints[earlierIdx].items = data.sprints[earlierIdx].items.filter(i => i.status !== 'pending');
data.sprints[backlogIdx].items = [...data.sprints[backlogIdx].items, ...strays];

fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
console.log(`Moved ${strays.length} pending items from shipped-earlier → backlog`);
