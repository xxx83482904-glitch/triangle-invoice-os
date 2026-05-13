type PrismaClientLike = unknown;

let prisma: PrismaClientLike | null = null;

export async function getPrisma() {
  if (!prisma) {
    const clientModule = (await import("@prisma/client")) as unknown as {
      PrismaClient: new () => PrismaClientLike;
    };
    prisma = new clientModule.PrismaClient();
  }
  return prisma;
}
