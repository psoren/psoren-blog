import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			// Optional collaborator credit — when set, rendered as a byline under the title.
			// Convention: the blog-post skill sets this to 'Claude (Opus 4.7, 1M context)'
			// for any post it drafted, so AI-drafted content is visibly disclosed.
			coauthor: z.string().optional(),
		}),
});

export const collections = { blog };
