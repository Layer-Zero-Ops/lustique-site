import { defineType, defineField } from "sanity";

/**
 * A service offered by Lustique Co.
 * `priceDisplay` is a display string (e.g. "from R850") — NOT a number.
 * Pricing logic lives in shared/pricing TypeScript; this field is copy only.
 */
export const service = defineType({
  name: "service",
  title: "Service",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Service name",
      type: "string",
      validation: (rule) => rule.required().max(100),
    }),
    defineField({
      name: "category",
      title: "Category",
      type: "string",
      options: {
        list: [
          { title: "Bridal (The Wedding Day)", value: "bridal" },
          { title: "Beyond Bridal (Special Occasions)", value: "beyond-bridal" },
        ],
        layout: "radio",
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "description",
      title: "Description",
      type: "text",
      rows: 3,
      description: "Short description shown on the service card. 1–3 sentences.",
      validation: (rule) => rule.required().max(400),
    }),
    defineField({
      name: "priceDisplay",
      title: "Price display string",
      type: "string",
      description:
        'Display text only — e.g. "from R850" or "R750". Never sourced from the pricing calculator.',
      validation: (rule) => rule.required().max(40),
    }),
    defineField({
      name: "image",
      title: "Card image",
      type: "image",
      options: { hotspot: true },
      description: "Image shown on the service card (bridal services only).",
    }),
    defineField({
      name: "displayOrder",
      title: "Display order",
      type: "number",
      description: "Lower numbers appear first within each category.",
      validation: (rule) => rule.required().integer().min(1),
    }),
    defineField({
      name: "indicative",
      title: "Indicative pricing?",
      type: "boolean",
      description: 'Show * and "indicative — to be confirmed" note below this card.',
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: "title", subtitle: "priceDisplay", media: "image" },
    prepare({ title, subtitle, media }: { title: string; subtitle: string; media: unknown }) {
      return { title: title ?? "Unnamed service", subtitle: subtitle ?? "", media };
    },
  },
});
