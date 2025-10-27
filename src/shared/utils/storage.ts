import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../../data');

export class JsonStorage<T> {
  private filePath: string;

  constructor(filename: string) {
    this.filePath = join(DATA_DIR, filename);
  }

  async read(): Promise<T[]> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data) as T[];
    } catch {
      return [];
    }
  }

  async write(data: T[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async findById(id: number | string, idField: keyof T = 'id' as keyof T): Promise<T | null> {
    const items = await this.read();
    return items.find((item) => item[idField] === id) ?? null;
  }

  async findOne(predicate: (item: T) => boolean): Promise<T | null> {
    const items = await this.read();
    return items.find(predicate) ?? null;
  }

  async create(item: T): Promise<T> {
    const items = await this.read();
    items.push(item);
    await this.write(items);
    return item;
  }

  async update(
    id: number | string,
    updates: Partial<T>,
    idField: keyof T = 'id' as keyof T
  ): Promise<T | null> {
    const items = await this.read();
    const index = items.findIndex((item) => item[idField] === id);

    if (index === -1) {
      return null;
    }

    items[index] = { ...items[index], ...updates };
    await this.write(items);
    return items[index];
  }

  async delete(id: number | string, idField: keyof T = 'id' as keyof T): Promise<boolean> {
    const items = await this.read();
    const filtered = items.filter((item) => item[idField] !== id);

    if (filtered.length === items.length) {
      return false;
    }

    await this.write(filtered);
    return true;
  }
}
