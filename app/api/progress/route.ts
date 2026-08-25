import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

const TASKS_FILE_PATH = resolve(process.cwd(), "tasks.json");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, max-age=0",
};

interface ProgressData {
  version: number;
  updatedAt: string;
  done: Record<string, string>;
  notes: Record<string, string>;
  cols: string[];
  cells: Record<string, string>;
}

const DEFAULT_DATA: ProgressData = {
  version: 1,
  updatedAt: new Date().toISOString(),
  done: {},
  notes: {},
  cols: [],
  cells: {},
};

async function readTasksFile(): Promise<ProgressData> {
  try {
    const content = await readFile(TASKS_FILE_PATH, "utf-8");
    const parsed = JSON.parse(content);
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      done: (typeof parsed.done === "object" && parsed.done !== null && !Array.isArray(parsed.done)) ? parsed.done : {},
      notes: (typeof parsed.notes === "object" && parsed.notes !== null && !Array.isArray(parsed.notes)) ? parsed.notes : {},
      cols: Array.isArray(parsed.cols) ? parsed.cols.filter((c: unknown) => typeof c === "string" && c.trim()) : [],
      cells: (typeof parsed.cells === "object" && parsed.cells !== null && !Array.isArray(parsed.cells)) ? parsed.cells : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeTasksFile(DEFAULT_DATA);
      return DEFAULT_DATA;
    }
    console.error("Lỗi khi đọc file tasks.json:", error);
    return DEFAULT_DATA;
  }
}

async function writeTasksFile(data: ProgressData): Promise<void> {
  const jsonContent = JSON.stringify(data, null, 2) + "\n";
  await writeFile(TASKS_FILE_PATH, jsonContent, "utf-8");
}

export async function GET() {
  try {
    const data = await readTasksFile();
    return Response.json(
      {
        ok: true,
        source: "tasks.json",
        data,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (error) {
    console.error("Lỗi GET /api/progress:", error);
    return Response.json(
      {
        ok: false,
        error: "Không thể đọc dữ liệu tiến độ từ đĩa.",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: Partial<ProgressData> = {};
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: "Dữ liệu JSON không hợp lệ." },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const cleanData: ProgressData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      done: (typeof body.done === "object" && body.done !== null && !Array.isArray(body.done)) ? body.done : {},
      notes: (typeof body.notes === "object" && body.notes !== null && !Array.isArray(body.notes)) ? body.notes : {},
      cols: Array.isArray(body.cols) ? body.cols.filter(c => typeof c === "string" && c.trim()) : [],
      cells: (typeof body.cells === "object" && body.cells !== null && !Array.isArray(body.cells)) ? body.cells : {},
    };

    await writeTasksFile(cleanData);

    return Response.json(
      {
        ok: true,
        message: "Đã lưu vào tasks.json",
        updatedAt: cleanData.updatedAt,
        data: cleanData,
      },
      {
        status: 200,
        headers: CORS_HEADERS,
      }
    );
  } catch (error) {
    console.error("Lỗi POST /api/progress:", error);
    return Response.json(
      {
        ok: false,
        error: "Không thể ghi dữ liệu tiến độ vào file tasks.json trên đĩa.",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
