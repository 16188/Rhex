import { createDaily60sAdminController } from "./daily-60s-admin.controller.js?v=1.1.6"
import { createDaily60sAdminView } from "./daily-60s-admin.view.js?v=1.1.6"

export function createComponent(sdk) {
  const useDaily60sAdminController = createDaily60sAdminController(sdk)
  const Daily60sAdminView = createDaily60sAdminView(sdk)

  return function Daily60sAdminEntry(props) {
    const controller = useDaily60sAdminController(props)
    return sdk.React.createElement(Daily60sAdminView, { controller })
  }
}
