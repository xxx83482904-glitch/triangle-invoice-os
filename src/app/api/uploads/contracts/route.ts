import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, contractFileUrl, maxUploadSize, saveContractFile } from "@/lib/files";
import { extractDocumentText, inferContractBilling } from "@/lib/ocr";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "manage:projects")) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const formData = await request.formData();
  const projectId = field(formData, "projectId");
  const company = companyFromParam(field(formData, "company"));
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "契約書ファイルを選択してください" }, { status: 400 });
  }

  const extension = allowedUploadTypes.get(file.type);
  if (!extension) {
    return NextResponse.json({ error: "PDF、JPEG、PNGのみアップロードできます" }, { status: 400 });
  }
  if (file.size > maxUploadSize) {
    return NextResponse.json({ error: "ファイルサイズは10MB以内にしてください" }, { status: 400 });
  }

  const data = readData();
  const before = data.projects.find((project) => project.id === projectId && !project.deletedAt);
  if (!before) return NextResponse.json({ error: "案件が見つかりません" }, { status: 404 });

  const id = newId();
  const timestamp = new Date().toISOString();
  const safeName = `contract-${id}${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const extracted = await extractDocumentText(file.name, file.type, buffer);
  const inferred = inferContractBilling(extracted);
  const fileUrl = contractFileUrl(safeName);

  await saveContractFile(safeName, buffer);

  mutateData(user.id, "UPLOAD_PROJECT_CONTRACT", "Project", projectId, (draft) => {
    const project = draft.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("案件が見つかりません");

    project.contractFileUrl = fileUrl;
    project.contractOriginalFileName = file.name;
    project.contractMimeType = file.type;
    project.contractOcrText = extracted.text;
    project.contractExtractedAmount = inferred.total || undefined;
    project.contractExtractedBillingCount = inferred.billingCount;
    project.contractUploadedAt = timestamp;
    if (inferred.total > 0) project.contractAmount = inferred.total;
    project.billingCount = inferred.billingCount;
    project.updatedAt = timestamp;

    draft.attachments.unshift({
      id: newId(),
      relatedType: "ProjectContract",
      relatedId: projectId,
      fileUrl,
      fileName: file.name,
      mimeType: file.type,
      uploadedById: user.id,
      createdAt: timestamp,
    });

    return {
      inferred,
      projectId,
      fileName: file.name,
    };
  }, before);

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${projectId}`);

  return NextResponse.redirect(new URL(`/projects?company=${company}&contractUploaded=${projectId}`, request.url), { status: 303 });
}
