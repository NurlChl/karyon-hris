import { wrapRouteHandler, apiSuccess, apiError } from "@/lib/api";
import Position from "@/models/Position";
import "@/models/Division";
import { connectToDatabase } from "@/lib/db";

export const GET = wrapRouteHandler(async (req) => {
  await connectToDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const position = await Position.findById(id).populate({
      path: "divisionId",
      select: "name branchId",
      populate: {
        path: "branchId",
        select: "name"
      }
    });
    if (!position || position.status !== "active") {
      return apiError("NOT_FOUND", "Lowongan kerja tidak ditemukan atau sudah ditutup", null, 404);
    }
    return apiSuccess(position, "Berhasil memuat detail lowongan kerja");
  }

  const positions = await Position.find({ status: "active" }).populate({
    path: "divisionId",
    select: "name branchId",
    populate: {
      path: "branchId",
      select: "name"
    }
  });
  return apiSuccess(positions, "Berhasil memuat data lowongan kerja aktif");
});
