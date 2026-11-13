import * as React from "react";

export default function Form({ action: _a, ...rest }: React.FormHTMLAttributes<HTMLFormElement> & { action?: unknown }) {
  return <form onSubmit={(event) => event.preventDefault()} {...rest} />;
}
