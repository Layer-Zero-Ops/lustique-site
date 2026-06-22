import { defineType, defineField } from "sanity";

/**
 * Singleton document for global site settings.
 * Only one document of this type should exist (enforced by __experimental_actions).
 * Hero headline + sub-headline drive the index.astro hero section.
 * Testimonials on the homepage are controlled by the `featured` flag on testimonial documents.
 */
export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  __experimental_actions: ["update", "publish"],
  fields: [
    defineField({
      name: "heroHeadline",
      title: "Hero headline",
      type: "string",
      description: 'The main H1 on the homepage hero. Current: "Feel most like yourself."',
      validation: (rule) => rule.required().max(120),
    }),
    defineField({
      name: "heroSubheadline",
      title: "Hero sub-headline",
      type: "text",
      rows: 2,
      description: "The paragraph below the hero headline.",
      validation: (rule) => rule.required().max(300),
    }),
  ],
  preview: {
    select: { title: "heroHeadline" },
    prepare({ title }: { title: string }) {
      return { title: title ?? "Site Settings" };
    },
  },
});
