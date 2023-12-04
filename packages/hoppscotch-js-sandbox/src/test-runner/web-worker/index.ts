import * as TE from "fp-ts/TaskEither"

import { TestResponse, TestResult } from "../../types"
import { SandboxTestResult } from "~/node"

import Worker from "./worker?worker&inline"

export const execTestScriptForWeb = (
  testScript: string,
  envs: TestResult["envs"],
  response: TestResponse
): Promise<TE.TaskEither<string, SandboxTestResult>> => {
  return new Promise((resolve) => {
    const worker = new Worker()

    const messageId = Date.now().toString()

    // Listen for the result from the web worker
    worker.addEventListener("message", (event: MessageEvent) => {
      console.log("Received message from worker", event.data)

      if (event.data.messageId === messageId) {
        if (event.data.result) {
          resolve(event.data.result)
        } else {
          resolve(event.data.result)
        }
      }
    })

    // Send the script to the web worker
    worker.postMessage({
      messageId,
      testScript,
      envs,
      response,
    })
  })
}
