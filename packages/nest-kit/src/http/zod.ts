import { Body, PipeTransform, Query } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Validates and parses input with a Zod schema. Errors become a uniform 400. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}

/** `@ZBody(Schema) body: z.infer<typeof Schema>` */
export const ZBody = (schema: ZodTypeAny) => Body(new ZodPipe(schema));

/** `@ZQuery(Schema) q: z.infer<typeof Schema>` */
export const ZQuery = (schema: ZodTypeAny) => Query(new ZodPipe(schema));
