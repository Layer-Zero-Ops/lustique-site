import { defineType, defineField } from "sanity";

/**
 * A testimonial quote from a Lustique bride.
 * Only testimonials with featured=true appear in the homepage slider.
 */
export const testimonial = defineType({
  name: "testimonial",
  title: "Testimonial",
  type: "document",
  fields: [
    defineField({
      name: "quote",
      title: "Quote",
      type: "text",
      rows: 4,
      description: "The bride's words, verbatim.",
      validation: (rule) => rule.required().max(600),
    }),
    defineField({
      name: "attribution",
      title: "Attribution",
      type: "string",
      description: 'How to credit this review. Leave blank to show "A Lustique Bride".',
      validation: (rule) => rule.max(80),
    }),
    defineField({
      name: "rating",
      title: "Rating",
      type: "number",
      options: {
        list: [
          { title: "★★★★★ (5)", value: 5 },
          { title: "★★★★ (4)", value: 4 },
          { title: "★★★ (3)", value: 3 },
        ],
        layout: "radio",
      },
      initialValue: 5,
      validation: (rule) => rule.required().integer().min(1).max(5),
    }),
    defineField({
      name: "featured",
      title: "Featured on homepage?",
      type: "boolean",
      description: "Only featured testimonials appear in the homepage slider.",
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: "quote", subtitle: "attribution" },
    prepare({ title, subtitle }: { title: string; subtitle: string }) {
      return {
        title: (title as string)?.slice(0, 80) ?? "Untitled testimonial",
        subtitle: subtitle ?? "A Lustique Bride",
      };
    },
  },
});
