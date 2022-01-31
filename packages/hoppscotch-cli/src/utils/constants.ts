/**
 * * Error codes for throwing known errors
 */
const errors = {
  HOPP000: {
    code: "HOPP000",
    message: "Unknown Error. Printing Raw Info.",
  },
  HOPP001: {
    code: "HOPP001",
    message: "File Not Found. Please Check Path URL.",
  },
  HOPP002: {
    code: "HOPP002",
    message:
      "Couldn't create debugging session! Make sure you are listening on Port 9999!",
  },
  HOPP003: {
    code: "HOPP003",
    message: "Malformed Collection JSON!",
  },
};

interface ResponseErrorPair {
  [key: number]: string;
}

const responseErrors: ResponseErrorPair = {
  501: "Request Not Supported",
  408: "Network Timeout",
  600: "Could Not Parse Response",
};

export { errors, responseErrors };
