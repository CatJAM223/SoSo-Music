import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { dialog } from 'electron';
import type { ZapretCheckResult, ZapretApplyResult } from '../../../shared/types';

export class ZapretService {
  private static cachedPath: string | null = null;

  /**
   * Automatically locates list-general.txt from Flowseal/zapret-discord-youtube
   */
  public static async findListGeneral(): Promise<ZapretCheckResult> {
    // 1. If previously discovered and file still exists
    if (this.cachedPath && fs.existsSync(this.cachedPath)) {
      return this.inspectFile(this.cachedPath);
    }

    const candidatePaths: string[] = [];

    // 2. Check running winws process location
    if (process.platform === 'win32') {
      try {
        const pids = execSync(
          'powershell -NoProfile -Command "Get-Process -Name winws -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
          { timeout: 3000 },
        )
          .toString()
          .trim()
          .split(/\s+/);

        for (const pid of pids) {
          if (!pid || !/^\d+$/.test(pid)) continue;
          try {
            const pPath = execSync(
              `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path"`,
              { timeout: 2000 },
            )
              .toString()
              .trim();

            if (pPath && fs.existsSync(pPath)) {
              const dir = path.dirname(pPath);
              const winwsCandidates = [
                path.join(dir, 'list-general.txt'),
                path.join(dir, 'lists', 'list-general.txt'),
                path.join(dir, '..', 'list-general.txt'),
                path.join(dir, '..', 'lists', 'list-general.txt'),
                path.join(dir, '..', '..', 'lists', 'list-general.txt'),
              ];
              for (const c of winwsCandidates) {
                if (fs.existsSync(c)) {
                  candidatePaths.push(path.resolve(c));
                }
              }
            }
          } catch {}
        }
      } catch {}
    }

    // 3. Scan common roots and user folders for zapret directories
    const userProfile =
      process.env.USERPROFILE || (process.platform === 'win32' ? 'C:\\Users\\Default' : '');
    const searchRoots: string[] = [];

    if (userProfile) {
      searchRoots.push(path.join(userProfile, 'Downloads'));
      searchRoots.push(path.join(userProfile, 'Desktop'));
    }

    if (process.platform === 'win32') {
      const drives = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'H:\\'];
      for (const d of drives) {
        if (fs.existsSync(d)) searchRoots.push(d);
      }
    }

    for (const root of searchRoots) {
      try {
        if (!fs.existsSync(root)) continue;
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.toLowerCase().includes('zapret')) {
            const zapretDir = path.join(root, entry.name);
            const directChecks = [
              path.join(zapretDir, 'list-general.txt'),
              path.join(zapretDir, 'lists', 'list-general.txt'),
              path.join(zapretDir, 'list-general-user.txt'),
            ];

            for (const dc of directChecks) {
              if (fs.existsSync(dc)) {
                candidatePaths.push(path.resolve(dc));
              }
            }

            // Check 1 level of subfolders (common for nested zip extractions)
            try {
              const subEntries = fs.readdirSync(zapretDir, { withFileTypes: true });
              for (const sub of subEntries) {
                if (sub.isDirectory()) {
                  const nestedChecks = [
                    path.join(zapretDir, sub.name, 'lists', 'list-general.txt'),
                    path.join(zapretDir, sub.name, 'list-general.txt'),
                    path.join(zapretDir, sub.name, 'list-general-user.txt'),
                  ];
                  for (const nc of nestedChecks) {
                    if (fs.existsSync(nc)) {
                      candidatePaths.push(path.resolve(nc));
                    }
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    // Prioritize list-general.txt
    const unique = Array.from(new Set(candidatePaths));
    if (unique.length > 0) {
      const target = unique.find((p) => p.endsWith('list-general.txt')) || unique[0];
      this.cachedPath = target;
      return this.inspectFile(target);
    }

    return {
      found: false,
      hasSoundcloud: false,
      hasSndcdn: false,
    };
  }

  /**
   * Inspects a candidate file and checks for domain presence
   */
  public static inspectFile(filePath: string): ZapretCheckResult {
    try {
      if (!fs.existsSync(filePath)) {
        return { found: false, hasSoundcloud: false, hasSndcdn: false };
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const hasSoundcloud = /(^|\r?\n)\s*soundcloud\.com\s*(\r?\n|$)/i.test(content);
      const hasSndcdn = /(^|\r?\n)\s*sndcdn\.com\s*(\r?\n|$)/i.test(content);

      return {
        found: true,
        path: filePath,
        hasSoundcloud,
        hasSndcdn,
      };
    } catch (e: any) {
      return {
        found: false,
        hasSoundcloud: false,
        hasSndcdn: false,
        error: e?.message || 'Failed to read file',
      };
    }
  }

  /**
   * Appends SoundCloud domains to the discovered or user-selected Zapret list.
   */
  public static async addDomainsToList(): Promise<ZapretApplyResult> {
    const targetPath = this.cachedPath;
    if (!targetPath || !fs.existsSync(targetPath)) {
      // Re-scan if no path known
      const scan = await this.findListGeneral();
      if (!scan.found || !scan.path) {
        return {
          success: false,
          path: '',
          message: 'Файл list-general.txt не найден на вашем компьютере. Выберите его вручную.',
        };
      }
      return this.addDomainsToList();
    }

    // Only modify files discovered by this service or explicitly selected through
    // the native file picker. Never accept a renderer supplied path here.
    const allowedNames = new Set(['list-general.txt', 'list-general-user.txt']);
    if (!allowedNames.has(path.basename(targetPath).toLowerCase())) {
      return {
        success: false,
        path: '',
        message: 'Выбранный файл не похож на список Zapret.',
      };
    }

    try {
      const content = fs.readFileSync(targetPath, 'utf8');
      const hasSoundcloud = /(^|\r?\n)\s*soundcloud\.com\s*(\r?\n|$)/i.test(content);
      const hasSndcdn = /(^|\r?\n)\s*sndcdn\.com\s*(\r?\n|$)/i.test(content);

      if (hasSoundcloud && hasSndcdn) {
        return {
          success: true,
          path: targetPath,
          message: 'Домены soundcloud.com и sndcdn.com уже добавлены в этот список.',
        };
      }

      // Create backup before writing
      try {
        const backupPath = `${targetPath}.soso.bak`;
        if (!fs.existsSync(backupPath)) {
          fs.writeFileSync(backupPath, content, 'utf8');
        }
      } catch {}

      // Detect newline style
      const eol = content.includes('\r\n') ? '\r\n' : '\n';

      const additions: string[] = [];
      if (!hasSoundcloud) additions.push('soundcloud.com');
      if (!hasSndcdn) additions.push('sndcdn.com');

      let updatedContent = content;
      if (!updatedContent.endsWith('\n') && !updatedContent.endsWith('\r')) {
        updatedContent += eol;
      }
      updatedContent += additions.join(eol) + eol;

      fs.writeFileSync(targetPath, updatedContent, 'utf8');
      this.cachedPath = targetPath;

      return {
        success: true,
        path: targetPath,
        message: `Домены успешно добавлены в ${path.basename(targetPath)}! Перезапустите службу Zapret (service.bat), если она была запущена.`,
      };
    } catch (e: any) {
      console.error('[ZapretService] addDomainsToList error:', e);
      return {
        success: false,
        path: targetPath,
        message: `Не удалось записать в файл: ${e?.message || 'Ошибка доступа'}`,
      };
    }
  }

  /**
   * Opens native file dialog to manually select list-general.txt
   */
  public static async selectCustomFile(): Promise<{
    canceled: boolean;
    filePath?: string;
    checkResult?: ZapretCheckResult;
  }> {
    try {
      const res = await dialog.showOpenDialog({
        title: 'Выберите файл list-general.txt утилиты Zapret',
        filters: [
          { name: 'Текстовые списки Zapret', extensions: ['txt'] },
          { name: 'Все файлы', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (res.canceled || res.filePaths.length === 0) {
        return { canceled: true };
      }

      const selected = res.filePaths[0];
      this.cachedPath = selected;
      const check = this.inspectFile(selected);
      return {
        canceled: false,
        filePath: selected,
        checkResult: check,
      };
    } catch (e) {
      console.error('[ZapretService] selectCustomFile error:', e);
      return { canceled: true };
    }
  }
}
