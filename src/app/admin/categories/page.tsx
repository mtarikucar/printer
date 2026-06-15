export const dynamic = "force-dynamic";

import { getCategoryTree } from "@/lib/services/categories";
import { CategoriesClient } from "./categories-client";

export default async function AdminCategoriesPage() {
  const tree = await getCategoryTree();
  return <CategoriesClient initialTree={tree} />;
}
