import { join } from 'path';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FileStorageService {
  root() {
    return process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');
  }

  async saveBytes(relativeDir: string, fileName: string, buffer: Buffer) {
    const directory = join(this.root(), relativeDir);
    await mkdir(directory, { recursive: true });
    const safeName = fileName.replace(/[^\w.\-() ]+/g, '_');
    const relative = `${relativeDir.replace(/\\/g, '/')}/${safeName}`;
    await writeFile(join(this.root(), relative), buffer);
    return relative;
  }

  async saveImportFile(companyId: string, importId: string, fileName: string, buffer: Buffer) {
    const directory = join(this.root(), 'imports', companyId, importId);
    await mkdir(directory, { recursive: true });
    const safeName = fileName.replace(/[^\w.\-() ]+/g, '_');
    const relative = join('imports', companyId, importId, safeName);
    await writeFile(join(this.root(), relative), buffer);
    return relative.replace(/\\/g, '/');
  }

  async saveJson(relativeDir: string, name: string, value: unknown) {
    const directory = join(this.root(), relativeDir);
    await mkdir(directory, { recursive: true });
    const relative = `${relativeDir.replace(/\\/g, '/')}/${name}`;
    await writeFile(join(this.root(), relative), JSON.stringify(value));
    return relative;
  }

  async read(relative: string): Promise<Buffer> {
    return readFile(join(this.root(), relative));
  }

  async readJson<T>(relative: string): Promise<T> {
    const raw = await readFile(join(this.root(), relative), 'utf8');
    return JSON.parse(raw) as T;
  }

  async remove(relative: string) {
    await unlink(join(this.root(), relative)).catch(() => undefined);
  }
}
