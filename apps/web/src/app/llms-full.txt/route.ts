import { getContent } from "@/lib/api/content";
import { llms, markdown } from "@/lib/llms";

export async function GET() {
  return markdown(llms(await getContent(), true));
}
