import { PersistenceService } from "~/services/persistence"
import {
  OauthAuthService,
  createFlowConfig,
  decodeResponseAsJSON,
  generateRandomString,
} from "../oauth.service"
import { z } from "zod"
import { getService } from "~/modules/dioc"
import * as E from "fp-ts/Either"
import { InterceptorService } from "~/services/interceptor.service"
import { AuthCodeGrantTypeParams } from "@hoppscotch/data"

const persistenceService = getService(PersistenceService)
const interceptorService = getService(InterceptorService)

const AuthCodeOauthFlowParamsSchema = AuthCodeGrantTypeParams.pick({
  authEndpoint: true,
  tokenEndpoint: true,
  clientID: true,
  clientSecret: true,
  scopes: true,
  isPKCE: true,
  codeVerifierMethod: true,
}).refine((params) => (params.isPKCE ? !!params.codeVerifierMethod : true), {
  message: "codeVerifierMethod is required when using PKCE",
  path: ["codeVerifierMethod"],
})

export type AuthCodeOauthFlowParams = z.infer<
  typeof AuthCodeOauthFlowParamsSchema
>

export const getDefaultAuthCodeOauthFlowParams =
  (): AuthCodeOauthFlowParams => ({
    authEndpoint: "",
    tokenEndpoint: "",
    clientID: "",
    clientSecret: "",
    scopes: undefined,
    isPKCE: false,
    codeVerifierMethod: "S256",
  })

const initAuthCodeOauthFlow = async ({
  tokenEndpoint,
  clientID,
  clientSecret,
  scopes,
  authEndpoint,
  isPKCE,
  codeVerifierMethod,
}: AuthCodeOauthFlowParams) => {
  const state = generateRandomString()

  let codeVerifier: string | undefined
  let codeChallenge: string | undefined

  if (isPKCE) {
    codeVerifier = generateCodeVerifier()
    codeChallenge = await generateCodeChallenge(
      codeVerifier,
      codeVerifierMethod
    )
  }

  let oauthTempConfig: {
    state: string
    grant_type: "AUTHORIZATION_CODE"
    tokenEndpoint: string
    clientSecret: string
    clientID: string
    codeVerifier?: string
    codeChallenge?: string
  } = {
    state,
    grant_type: "AUTHORIZATION_CODE",
    tokenEndpoint,
    clientSecret,
    clientID,
  }

  if (codeVerifier && codeChallenge) {
    oauthTempConfig = {
      ...oauthTempConfig,
      codeVerifier,
      codeChallenge,
    }
  }

  // Get the source (`REST` | `GraphQL`) from where the request was initiated
  const localConfig = persistenceService.getLocalConfig("oauth_temp_config")
  const source = localConfig ? { source: JSON.parse(localConfig).source } : {}

  // persist the state so we can compare it when we get redirected back
  // also persist the grant_type,tokenEndpoint and clientSecret so we can use them when we get redirected back
  persistenceService.setLocalConfig(
    "oauth_temp_config",
    JSON.stringify({
      ...source,
      ...oauthTempConfig,
    })
  )

  let url: URL

  try {
    url = new URL(authEndpoint)
  } catch (e) {
    return E.left("INVALID_AUTH_ENDPOINT")
  }

  url.searchParams.set("grant_type", "authorization_code")
  url.searchParams.set("client_id", clientID)
  url.searchParams.set("state", state)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", OauthAuthService.redirectURI)

  if (scopes) url.searchParams.set("scope", scopes)

  if (codeVerifierMethod && codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge)
    url.searchParams.set("code_challenge_method", codeVerifierMethod)
  }

  // Redirect to the authorization server
  window.location.assign(url.toString())

  return E.right(undefined)
}

const handleRedirectForAuthCodeOauthFlow = async (localConfig: string) => {
  // parse the query string
  const params = new URLSearchParams(window.location.search)

  const code = params.get("code")
  const state = params.get("state")
  const error = params.get("error")

  if (error) {
    return E.left("AUTH_SERVER_RETURNED_ERROR")
  }

  if (!code) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED")
  }

  const expectedSchema = z.object({
    source: z.optional(z.string()),
    state: z.string(),
    tokenEndpoint: z.string(),
    clientSecret: z.string(),
    clientID: z.string(),
    codeVerifier: z.string().optional(),
    codeChallenge: z.string().optional(),
  })

  const decodedLocalConfig = expectedSchema.safeParse(JSON.parse(localConfig))

  if (!decodedLocalConfig.success) {
    return E.left("INVALID_LOCAL_CONFIG")
  }

  // check if the state matches
  if (decodedLocalConfig.data.state !== state) {
    return E.left("INVALID_STATE")
  }

  // exchange the code for a token
  const formData = new URLSearchParams()
  formData.append("grant_type", "authorization_code")
  formData.append("code", code)
  formData.append("client_id", decodedLocalConfig.data.clientID)
  formData.append("client_secret", decodedLocalConfig.data.clientSecret)
  formData.append("redirect_uri", OauthAuthService.redirectURI)

  if (decodedLocalConfig.data.codeVerifier) {
    formData.append("code_verifier", decodedLocalConfig.data.codeVerifier)
  }

  const { response } = interceptorService.runRequest({
    url: decodedLocalConfig.data.tokenEndpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    data: formData.toString(),
  })

  const res = await response

  if (E.isLeft(res)) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED" as const)
  }

  const responsePayload = decodeResponseAsJSON(res.right)

  if (E.isLeft(responsePayload)) {
    return E.left("AUTH_TOKEN_REQUEST_FAILED" as const)
  }

  const withAccessTokenSchema = z.object({
    access_token: z.string(),
  })

  const parsedTokenResponse = withAccessTokenSchema.safeParse(
    responsePayload.right
  )

  return parsedTokenResponse.success
    ? E.right(parsedTokenResponse.data)
    : E.left("AUTH_TOKEN_REQUEST_INVALID_RESPONSE" as const)
}

const generateCodeVerifier = () => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const length = Math.floor(Math.random() * (128 - 43 + 1)) + 43 // Random length between 43 and 128
  let codeVerifier = ""

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length)
    codeVerifier += characters[randomIndex]
  }

  return codeVerifier
}

const generateCodeChallenge = async (
  codeVerifier: string,
  strategy: AuthCodeOauthFlowParams["codeVerifierMethod"]
) => {
  if (strategy === "plain") {
    return codeVerifier
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)

  const buffer = await crypto.subtle.digest("SHA-256", data)

  return encodeArrayBufferAsUrlEncodedBase64(buffer)
}

const encodeArrayBufferAsUrlEncodedBase64 = (buffer: ArrayBuffer) => {
  const hashArray = Array.from(new Uint8Array(buffer))
  const hashBase64URL = btoa(String.fromCharCode(...hashArray))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")

  return hashBase64URL
}

export default createFlowConfig(
  "AUTHORIZATION_CODE" as const,
  AuthCodeOauthFlowParamsSchema,
  initAuthCodeOauthFlow,
  handleRedirectForAuthCodeOauthFlow
)
