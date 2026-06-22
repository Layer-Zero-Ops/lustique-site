import { defineType, defineField } from "sanity";

/**
 * A single gallery image in the Lustique portfolio.
 * `artistId` maps to the slug field on teamMember documents.
 */
export const portfolioImage = defineType({
  name: "portfolioImage",
  title: "Portfolio Image",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      description: "A short internal title for this image (not shown on site)",
      validation: (rule) => rule.required().max(120),
    }),
    defineField({
      name: "image",
      title: "Image",
      type: "image",
      options: { hotspot: true },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "alt",
      title: "Alt text",
      type: "string",
      description: "Describe the image for screen readers and search engines",
      validation: (rule) =>
        rule
          .required()
          .max(200)
          .warning("Good alt text is under 200 characters."),
    }),
    defineField({
      name: "category",
      title: "Category",
      type: "string",
      options: {
        list: [
          { title: "Makeup", value: "makeup" },
          { title: "Hair", value: "hair" },
          { title: "Bridal Party", value: "party" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "artistId",
      title: "Artist",
      type: "string",
      description: "Artist's ID slug (no accents) — must match the slug field on the teamMember document.",
      options: {
        list: [
          { title: "Zandeline", value: "zandeline" },
          { title: "Monique", value: "monique" },
          { title: "Marize", value: "marize" },
          { title: "Jana", value: "jana" },
          { title: "Janeke", value: "janeke" },
          { title: "Elria", value: "elria" },
          { title: "Maroné", value: "marone" },
          { title: "René", value: "rene" },
          { title: "Samantha", value: "samantha" },
        ],
        layout: "dropdown",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "displayOrder",
      title: "Display order",
      type: "number",
      description: "Lower numbers appear first in the gallery. Leave blank for natural order.",
    }),
  ],
  preview: {
    select: { title: "title", media: "image", subtitle: "artistId" },
    prepare({ title, media, subtitle }: { title: string; media: unknown; subtitle: string }) {
      return { title: title ?? "Untitled image", media, subtitle: `Artist: ${subtitle ?? "—"}` };
    },
  },
});
