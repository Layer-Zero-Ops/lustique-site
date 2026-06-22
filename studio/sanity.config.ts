import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import {
  portfolioImage,
  teamMember,
  blogPost,
  service,
  testimonial,
  siteSettings,
} from "./schemas";

export default defineConfig({
  name: "lustique",
  title: "Lustique Co.",
  projectId: process.env.SANITY_STUDIO_PROJECT_ID ?? "",
  dataset: "production",

  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Content")
          .items([
            S.listItem()
              .title("Site Settings")
              .child(
                S.document()
                  .schemaType("siteSettings")
                  .documentId("siteSettings")
              ),
            S.divider(),
            S.documentTypeListItem("portfolioImage").title("Portfolio Images"),
            S.documentTypeListItem("teamMember").title("Team Members"),
            S.documentTypeListItem("blogPost").title("Blog Posts"),
            S.documentTypeListItem("service").title("Services"),
            S.documentTypeListItem("testimonial").title("Testimonials"),
          ]),
    }),
    visionTool(),
  ],

  schema: {
    types: [portfolioImage, teamMember, blogPost, service, testimonial, siteSettings],
  },
});
