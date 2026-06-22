import { defineType, defineField } from "sanity";

/**
 * An artist on the Lustique team.
 * `slug` is auto-generated from `name` with accents stripped — this becomes
 * the join key used in portfolioImage.artistId and site filter buttons.
 */
export const teamMember = defineType({
  name: "teamMember",
  title: "Team Member",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      description: "Display name with accents (e.g. Maroné, René)",
      validation: (rule) => rule.required().max(80),
    }),
    defineField({
      name: "slug",
      title: "ID slug",
      type: "slug",
      description:
        "Auto-generated from name with accents stripped. Do not change after publishing.",
      options: {
        source: "name",
        maxLength: 96,
        slugify: (input: string) =>
          input
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "role",
      title: "Role",
      type: "string",
      options: {
        list: [
          { title: "Founder", value: "Founder" },
          { title: "Bridal Artist", value: "Bridal Artist" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "bio",
      title: "Bio",
      type: "text",
      rows: 4,
      description: "A short, warm paragraph about this artist. 2–4 sentences.",
      validation: (rule) => rule.required().max(600),
    }),
    defineField({
      name: "photo",
      title: "Photo",
      type: "image",
      options: { hotspot: true },
      description: "Portrait photo. Landscape images are cropped to square.",
    }),
    defineField({
      name: "displayOrder",
      title: "Display order",
      type: "number",
      description: "Lower numbers appear first. Zandeline should be 1.",
      validation: (rule) => rule.required().integer().min(1),
    }),
  ],
  preview: {
    select: { title: "name", media: "photo", subtitle: "role" },
    prepare({ title, media, subtitle }: { title: string; media: unknown; subtitle: string }) {
      return { title: title ?? "Unnamed artist", media, subtitle: subtitle ?? "" };
    },
  },
});
