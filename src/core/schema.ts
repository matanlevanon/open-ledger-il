import { z } from 'zod';

/**
 * `schema.partial()` on a zod object whose fields carry `.default(...)` does not leave an omitted
 * field unset the way "partial" implies: zod still applies the field's own default when the key is
 * missing, so a caller who means "leave this column alone" instead resets it to the default on
 * every partial update. Found in `clientPatch` (R18): a `PATCH /clients` that only meant to change
 * one field silently reset `currency`, `country`, `foreignResident` and `clientCopyLang` back to
 * their defaults whenever the request omitted them.
 *
 * This builds the same partial shape but strips each field's own default first, so an omitted key
 * parses to `undefined`, which every `*Patch`-consuming service here already treats as "leave this
 * column alone" (`patch[key] !== undefined`).
 */
export function partialWithoutDefaults<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): z.ZodObject<{ [K in keyof Shape]: z.ZodOptional<Shape[K] extends z.ZodDefault<infer Inner> ? Inner : Shape[K]> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod v4's public shape type
  // (`$ZodType`, its internal base) is not assignable to the `ZodType` its own `.optional()` and
  // `z.object()` expect; the real safety is the generic signature above, which every call site
  // below actually type-checks against.
  const shape = schema.shape as Record<string, any>;
  const newShape: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const field = shape[key];
    const bare = field instanceof z.ZodDefault ? field.removeDefault() : field;
    newShape[key] = bare.optional();
  }
  return z.object(newShape as z.ZodRawShape) as ReturnType<typeof partialWithoutDefaults<Shape>>;
}
