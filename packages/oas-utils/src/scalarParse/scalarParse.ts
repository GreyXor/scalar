import {
  type OpenAPIV3_1,
  type ResolvedOpenAPI,
  type ResolvedOpenAPIV2,
  type ResolvedOpenAPIV3,
  type ResolvedOpenAPIV3_1,
  openapi,
} from '@scalar/openapi-parser'
import { z } from 'zod'

import {
  type Operation,
  OperationSchema,
  RemoveUndefined,
  type RequestMethod,
  type Spec,
  type Tag,
  type TransformedOperation,
  objectKeys,
  requestMethodSchema,
  tagSchema,
  transformedOperationSchema,
  validRequestMethods,
} from '../types'

/**
 * Parse and transform an OpenAPI specification for rendering
 */
export const scalarParse = (specification: any): Promise<Spec> => {
  // TODO: does this need to be a promise?
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      const result = await openapi().load(specification).resolve()

      if (result.schema === undefined) {
        throw 'Failed to parse the OpenAPI file.'
      }

      if (result.errors?.length) {
        console.warn(
          'Please open an issue on https://github.com/scalar/scalar\n',
          'Scalar OpenAPI Parser Warning:\n',
          result.errors,
        )
      }

      /**
       * conditional type if schema extends a certain type ?
       */

      type SchemaType = typeof result.schema

      // TODO: zod schema parse
      const schema: ResolvedOpenAPI.Document = result.schema
      resolve(transformResult(structuredClone(schema)))
    } catch (error) {
      reject(error)
    }
  })
}

/** Transform a resolved OpenAPI spec from the OpenAPI Parser for better rendering */
export const transformResult = <TSpec extends ResolvedOpenAPI.Document>(
  schema: TSpec,
): Spec => {
  const tags = initTags(schema)
  const paths = initPaths(schema)

  /** Transform request methods, operations, tags */
  Object.keys(paths).forEach((path: string) => {
    // for each path, format operation data and add operations to tags

    objectKeys(paths[path]).forEach((requestMethod) => {
      // Check if the request method is valid
      const method = requestMethodSchema.parse(requestMethod.toUpperCase())
      if (method) {
        // TODO: zod parse this object
        // const operation = OperationSchema.parse(paths[path][requestMethod])
        const operation = paths[path][
          requestMethod
        ] as ResolvedOpenAPI.Operation

        // Transform the operation
        const newOperation = {
          httpVerb: requestMethod,
          path,
          operationId: operation.operationId || path,
          name: operation.summary || path || '',
          description: operation.description || '',
          information: {
            ...operation,
          },
          pathParameters: paths[path]?.parameters,
        } as TransformedOperation

        // If the operation has no tags, add operation to the default tag
        if (!operation.tags || operation.tags.length === 0) {
          // Create the default tag.

          // find the index of the default tag
          const indexOfDefaultTag = tags.findIndex(
            (tag) => tag.name === 'default',
          )

          // Add the new operation to the default tag.
          if (indexOfDefaultTag >= 0) {
            // Add the new operation to the default tag.
            tags[indexOfDefaultTag].operations.push(newOperation)
          }
        }
        // If the operation has tags, loop through them.
        else {
          operation.tags.forEach((operationTag: string) => {
            // Try to find the tag in the schema
            const indexOfExistingTag = tags.findIndex(
              (tag) => tag.name === operationTag,
            )

            // Create tag if it doesn’t exist yet
            if (indexOfExistingTag === -1) {
              tags.push({
                name: operationTag,
                description: '',
                operations: [],
              })
            }

            // Decide where to store the new operation
            const tagIndex =
              indexOfExistingTag !== -1 ? indexOfExistingTag : tags.length - 1

            // Create operations array if it doesn’t exist yet
            if (typeof tags[tagIndex].operations === 'undefined') {
              tags[tagIndex].operations = []
            }
            // Add the new operation
            tags[tagIndex].operations.push(newOperation)
          })
        }
      }
    })
  })

  return {
    ...schema,
    webhooks: transformWebhooks(schema),
    paths: paths,
    tags: tags.filter((tag) => tag.operations.length > 0),
  }
}

/** Initialize and format tags array */
export const initTags = <T extends ResolvedOpenAPI.Document>(schema: T) => {
  const tags = new Array<z.infer<typeof tagSchema>>()

  const defaultTag = {
    name: 'default',
    description: '',
    operations: [],
  }

  // format existing tags
  if ('tags' in schema && schema.tags !== undefined && schema.tags !== null) {
    schema.tags.forEach((tag) => {
      tags.push(tagSchema.parse(tag))
    })
  }

  // Add the default tag if it doesn’t exist
  if (!tags.find((tag) => tag.name === 'default')) {
    tags.push(defaultTag)
  }

  return tags
}

/**
 * Initialize Paths if they don’t exist and properly type them
 */
export const initPaths = <T extends ResolvedOpenAPI.Document>(schema: T) => {
  if (
    'paths' in schema &&
    schema.paths !== undefined &&
    schema.paths !== null
  ) {
    const paths = schema.paths as Record<
      string,
      | ResolvedOpenAPIV3_1.PathsObject
      | ResolvedOpenAPIV2.PathsObject
      | ResolvedOpenAPIV3.PathsObject
    >
    return paths
  } else
    return {} as Record<
      string,
      | ResolvedOpenAPIV3_1.PathsObject
      | ResolvedOpenAPIV2.PathsObject
      | ResolvedOpenAPIV3.PathsObject
    >
}

/**
 * Transform webhooks data for rendering
 * Add Webhooks to the schema if they don’t exist and properly type them
 * Returns a new webhooks object with the transformed data
 */
// TODO: turn this into a zod schema?
export const transformWebhooks = <T extends ResolvedOpenAPI.Document>(
  schema: T,
) => {
  if (
    'webhooks' in schema &&
    schema.webhooks !== undefined &&
    schema.webhooks !== null
  ) {
    const webhooks = schema.webhooks as Record<
      string,
      ResolvedOpenAPIV3_1.PathItemObject
    >

    const newWebhooks: Record<string, any> = {}
    Object.keys(webhooks).forEach((name) => {
      ;(Object.keys(webhooks[name] ?? {}) as OpenAPIV3_1.HttpMethods[]).forEach(
        (httpVerb) => {
          const originalWebhook = (
            webhooks?.[name] as OpenAPIV3_1.PathItemObject
          )[httpVerb]

          if (newWebhooks[name] === undefined) {
            newWebhooks[name] = {}
          }

          newWebhooks[name][httpVerb] = {
            // Transformed data
            httpVerb: httpVerb,
            path: name,
            operationId: originalWebhook?.operationId || name,
            name: originalWebhook?.summary || name || '',
            description: originalWebhook?.description || '',
            pathParameters: schema.paths?.[name]?.parameters,
            // Original webhook
            // TODO: This needs fixing - maybe don't use spread operator? not sure the intent here
            information: {
              ...originalWebhook,
            },
          }

          // Object.assign(
          //   (schema).webhooks?.[name]?.[httpVerb] ?? {},
          //   {},
          // )
          // Object.assign(
          //   (schema).webhooks?.[name]?.[httpVerb] ?? {},
          //   {},
          // )
          // information: {
          //   ...(schema).webhooks?.[name],
          // },
        },
      )
    })

    return newWebhooks
  } else return {} as Record<string, ResolvedOpenAPIV3_1.PathItemObject>
}

const loginFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const useForm = <TValues>(
  schema: z.Schema<TValues>,
  onSubmit: (values: TValues) => void,
) => {
  return {
    onSubmit: (values: unknown) => {
      const newValues = schema.parse(values)
      onSubmit(newValues)
    },
  }
}

const form = useForm(loginFormSchema, (values) => {
  console.log(values)
})
