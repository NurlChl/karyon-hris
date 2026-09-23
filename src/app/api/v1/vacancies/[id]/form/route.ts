import { z } from "zod";
import { wrapRouteHandler, apiSuccess, type RouteContext } from "@/lib/api";
import { requirePermission, parseBody, BadRequest, NotFound } from "@/lib/guard";
import { logActivity } from "@/lib/audit/logger";
import {
  FIELD_TYPE_LABELS,
  definitionProblems,
  defaultFormFields,
  normaliseFields,
  type FieldType,
  type FormField,
} from "@/lib/hr/application-form";
import { resolveFormFields } from "@/lib/hr/applications";
import JobVacancy from "@/models/JobVacancy";

type Ctx = RouteContext<{ id: string }>;

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABELS) as [FieldType, ...FieldType[]];

const fieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/, "Kode kolom tidak valid"),
  label: z.string().trim().max(120, "Label maksimal 120 karakter"),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  enabled: z.boolean(),
  system: z.string().nullable(),
  section: z.string().trim().max(60).default(""),
  placeholder: z.string().trim().max(150).default(""),
  helpText: z.string().trim().max(300).default(""),
  options: z.array(z.object({ value: z.string().trim().max(80), label: z.string().trim().max(120) })).max(50).default([]),
  maxFiles: z.number().int().min(1).max(10).default(1),
  allowLink: z.boolean().default(true),
});

const bodySchema = z.object({
  fields: z.array(fieldSchema).min(1).max(60, "Formulir maksimal 60 kolom"),
});

async function load(id: string) {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) throw BadRequest("ID lowongan tidak valid.");
  const vacancy = await JobVacancy.findById(id).select("title slug status formFields");
  if (!vacancy) throw NotFound("Lowongan tidak ditemukan.");
  return vacancy;
}

export const GET = wrapRouteHandler<Ctx>(async (req, { params }) => {
  await requirePermission(req, "recruitment", "read");
  const vacancy = await load((await params).id);
  return apiSuccess({
    vacancy: { _id: vacancy._id, title: vacancy.title, slug: vacancy.slug, status: vacancy.status },
    fields: resolveFormFields(vacancy),
    isDefault: !(vacancy.formFields as unknown[])?.length,
  });
});

export const PUT = wrapRouteHandler<Ctx>(async (req, { params }) => {
  const ctx = await requirePermission(req, "recruitment", "write");
  const vacancy = await load((await params).id);
  const body = await parseBody(req, bodySchema);

  // System fields keep their type: the hiring flow reads "cv" as attachments
  // and "email" as an address, so letting them become anything else would
  // quietly break it. Their definition comes from the defaults, not the client.
  const systemTypes = new Map(defaultFormFields().map((f) => [f.system, f.type]));
  for (const f of body.fields) {
    if (f.system && systemTypes.has(f.system as FormField["system"]) && systemTypes.get(f.system as FormField["system"]) !== f.type) {
      throw BadRequest(`Jenis isian kolom sistem "${f.label}" tidak dapat diubah.`);
    }
    if (f.system && !systemTypes.has(f.system as FormField["system"])) {
      throw BadRequest("Kolom sistem tidak dikenali.");
    }
  }

  const fields = normaliseFields(body.fields as FormField[]);
  const problems = definitionProblems(fields);
  if (problems.length) throw BadRequest(problems[0], { problems });

  vacancy.formFields = fields as unknown as Array<Record<string, unknown>>;
  vacancy.markModified("formFields");
  await vacancy.save();

  void logActivity({
    userId: ctx.user.id,
    action: "UPDATE_APPLICATION_FORM",
    module: "recruitment",
    after: {
      vacancy: vacancy.title,
      fields: fields.filter((f) => f.enabled).map((f) => `${f.label} (${f.type}${f.required ? ", wajib" : ""})`),
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return apiSuccess(
    { fields },
    "Formulir lamaran disimpan. Pelamar berikutnya mengisi formulir versi ini; lamaran yang sudah masuk tetap seperti saat dikirim."
  );
});
