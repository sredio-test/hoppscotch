import { Service } from "dioc"
import { PersistenceService } from "../persistence"
import { ZodType, z } from "zod"
import * as E from "fp-ts/Either"
import authCode from "./flows/authCode"
import implicit from "./flows/implicit"
import { getService } from "~/modules/dioc"

const persistenceService = getService(PersistenceService)

export const routeOAuthRedirect = async () => {
  // get the temp data from the local storage
  const localConfig = persistenceService.getLocalConfig("oauth_temp_config")

  if (!localConfig) {
    return E.left("INVALID_STATE")
  }

  const expectedSchema = z.object({
    source: z.optional(z.string()),
    grant_type: z.string(),
  })

  const decodedLocalConfig = expectedSchema.safeParse(JSON.parse(localConfig))

  if (!decodedLocalConfig.success) {
    return E.left("INVALID_STATE")
  }

  // route the request to the correct flow
  const flowConfig = [authCode, implicit].find(
    (flow) => flow.flow === decodedLocalConfig.data.grant_type
  )

  if (!flowConfig) {
    return E.left("INVALID_STATE")
  }

  return flowConfig?.onRedirectReceived(localConfig)
}

export function createFlowConfig<
  Flow extends string,
  AuthParams extends Record<string, unknown>,
  InitFuncReturnObject extends Record<string, unknown>,
>(
  flow: Flow,
  params: ZodType<AuthParams>,
  init: (
    params: AuthParams
  ) =>
    | E.Either<string, InitFuncReturnObject>
    | Promise<E.Either<string, InitFuncReturnObject>>
    | E.Either<string, undefined>
    | Promise<E.Either<string, undefined>>,
  onRedirectReceived: (localConfig: string) => Promise<
    E.Either<
      string,
      {
        access_token: string
      }
    >
  >
) {
  return {
    flow,
    params,
    init,
    onRedirectReceived,
  }
}

export const decodeResponseAsJSON = (response: { data: any }) => {
  try {
    const responsePayload = new TextDecoder("utf-8")
      .decode(response.data as any)
      .replaceAll("\x00", "")

    return E.right(JSON.parse(responsePayload) as Record<string, unknown>)
  } catch (error) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED" as const)
  }
}

export class OauthAuthService extends Service {
  public static readonly ID = "OAUTH_AUTH_SERVICE"

  static redirectURI = `${window.location.origin}/oauth`

  constructor() {
    super()
  }
}

export const generateRandomString = () => {
  const length = 64
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const values = crypto.getRandomValues(new Uint8Array(length))
  return values.reduce((acc, x) => acc + possible[x % possible.length], "")
}
