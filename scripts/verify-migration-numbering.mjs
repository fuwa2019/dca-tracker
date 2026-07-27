import { readdirSync } from 'node:fs';

const KNOWN_HISTORICAL_DUPLICATE_NUMBERS = ['0022', '0027'];
const KNOWN_DUPLICATE_SET = new Set(KNOWN_HISTORICAL_DUPLICATE_NUMBERS);
const MIGRATIONS_DIRECTORY = new URL('../supabase/migrations/', import.meta.url);
const MIGRATION_FILENAME = /^(\d{4})_.+\.sql$/;

const migrationFiles = readdirSync(MIGRATIONS_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isFile() && MIGRATION_FILENAME.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (migrationFiles.length === 0) {
  console.error('Migration 编号校验失败：supabase/migrations/ 下没有 NNNN_*.sql 文件。');
  process.exitCode = 1;
} else {
  const filesByNumber = new Map();
  for (const filename of migrationFiles) {
    const [, number] = MIGRATION_FILENAME.exec(filename);
    const files = filesByNumber.get(number) ?? [];
    files.push(filename);
    filesByNumber.set(number, files);
  }

  let failed = false;
  const duplicateEntries = [...filesByNumber.entries()]
    .filter(([, files]) => files.length > 1)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [number, files] of duplicateEntries) {
    if (KNOWN_DUPLICATE_SET.has(number) && files.length === 2) {
      console.warn(
        `警告：已知历史重复，非阻塞：${number} 有两个文件；`
        + `经审查确认互不依赖，见 docs/decisions/2026-07-27-migration-numbering-duplicates.md。\n`
        + `  - ${files.join('\n  - ')}`,
      );
      continue;
    }

    failed = true;
    const reason = KNOWN_DUPLICATE_SET.has(number)
      ? '已知编号出现了未审查的额外文件'
      : '新发现的重复编号';
    console.error(`Migration 编号校验失败：${reason} ${number}：\n  - ${files.join('\n  - ')}`);
  }

  const sortedNumbers = [...filesByNumber.keys()].sort();
  const maximumNumber = Number(sortedNumbers.at(-1));
  const missingNumbers = [];
  for (let number = 1; number <= maximumNumber; number += 1) {
    const paddedNumber = String(number).padStart(4, '0');
    if (!filesByNumber.has(paddedNumber)) missingNumbers.push(paddedNumber);
  }

  if (missingNumbers.length > 0) {
    failed = true;
    console.error(`Migration 编号校验失败：0001-${sortedNumbers.at(-1)} 存在缺号：${missingNumbers.join(', ')}`);
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(
      `Migration 编号校验通过：0001-${sortedNumbers.at(-1)} 连续，`
      + `未发现已知白名单之外的重复编号。`,
    );
  }
}
