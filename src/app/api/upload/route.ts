import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { saveFile } from "@/lib/services/storage";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: d["api.upload.noFile"] }, { status: 400 });
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      return NextResponse.json(
        { error: d["api.upload.invalidFormat"] },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: d["api.upload.tooLarge"] },
        { status: 400 }
      );
    }

    const ext = file.type === "image/png" ? "png" : "jpg";
    const filename = `${nanoid()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await saveFile(buffer, "photos", filename);

    return NextResponse.json({ key });
  } catch (error: any) {
    console.error("Upload failed:", error);
    return NextResponse.json(
      { error: d["api.upload.failed"] },
      { status: 500 }
    );
  }
}
