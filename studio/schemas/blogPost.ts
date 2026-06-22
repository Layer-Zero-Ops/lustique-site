import { defineType, defineField, defineArrayMember } from "sanity";

/**
 * A blog / journal article.
 * `slug` must be unique — enforced by validation below.
 * `body` is Portable Text. The only annotation mark type is `link` (with href + blank fields).
 */
export const blogPost = defineType({
  name: "blogPost",
  title: "Blog Post",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required().max(160),
    }),
    defineField({
      name: "slug",
      title: "Slug (URL)",
      type: "slug",
      description:
        "Auto-generated from title. Used in the URL: /blog/<slug>.html. Do not change after publishing.",
      options: {
        source: "title",
        maxLength: 96,
        slugify: (input: string) =>
          input
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
      },
      validation: (rule) => rule.required().unique(),
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      rows: 3,
      description: "Short summary shown on the blog index card. 1–2 sentences.",
      validation: (rule) => rule.required().max(300),
    }),
    defineField({
      name: "category",
      title: "Category (eyebrow label)",
      type: "string",
      options: {
        list: [
          { title: "Style", value: "Style" },
          { title: "Trials", value: "Trials" },
          { title: "Pretoria", value: "Pretoria" },
          { title: "Guide", value: "Guide" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "publishedAt",
      title: "Published at",
      type: "datetime",
      description: "Leave blank to use the document creation date.",
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "array",
      of: [
        defineArrayMember({
          type: "block",
          styles: [
            { title: "Normal", value: "normal" },
            { title: "Heading 2", value: "h2" },
            { title: "Heading 3", value: "h3" },
          ],
          marks: {
            decorators: [
              { title: "Strong", value: "strong" },
              { title: "Emphasis", value: "em" },
            ],
            annotations: [
              defineArrayMember({
                type: "object",
                name: "link",
                title: "Link",
                fields: [
                  defineField({
                    name: "href",
                    type: "string",
                    title: "URL",
                    description:
                      "For internal pages use relative paths with .html extension, e.g. portfolio.html",
                    validation: (rule) => rule.required(),
                  }),
                  defineField({
                    name: "blank",
                    type: "boolean",
                    title: "Open in new tab",
                    initialValue: false,
                  }),
                ],
              }),
            ],
          },
        }),
      ],
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "excerpt" },
    prepare({ title, subtitle }: { title: string; subtitle: string }) {
      return { title: title ?? "Untitled post", subtitle: subtitle ?? "" };
    },
  },
  orderings: [
    {
      title: "Published date, newest first",
      name: "publishedDesc",
      by: [{ field: "publishedAt", direction: "desc" as const }],
    },
  ],
});
