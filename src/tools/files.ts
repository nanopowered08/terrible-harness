import fs from "fs";
import path from "path";

export function readFile(filePath: string, startLine?: number, endLine?: number): { success: boolean; content?: string; error?: string } {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return { success: false, error: `${filePath} is a directory, not a file.` };
    }
    const text = fs.readFileSync(fullPath, "utf-8");
    if (startLine !== undefined || endLine !== undefined) {
      const lines = text.split("\n");
      const start = Math.max(1, startLine || 1) - 1;
      const end = endLine ? Math.min(lines.length, endLine) : lines.length;
      return {
        success: true,
        content: lines.slice(start, end).join("\n")
      };
    }
    return { success: true, content: text };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function writeFile(filePath: string, content: string, append: boolean = false): { success: boolean; bytesWritten?: number; error?: string } {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    if (append) {
      fs.appendFileSync(fullPath, content, "utf-8");
    } else {
      fs.writeFileSync(fullPath, content, "utf-8");
    }
    return { success: true, bytesWritten: Buffer.byteLength(content, "utf-8") };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
