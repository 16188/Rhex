import {
  applyActionResult,
  buildActionRequest,
  createConfigState,
  createInitialAdminState,
} from "./daily-60s-admin.model.js?v=1.1.6"

export function createDaily60sAdminController(sdk) {
  const React = sdk.React

  return function useDaily60sAdminController(props) {
    const [state, setState] = React.useState(() => createInitialAdminState(props))

    const setConfigField = React.useCallback((field, value) => {
      setState((current) => ({
        ...current,
        config: createConfigState({
          ...current.config,
          [field]: value,
        }),
      }))
    }, [])

    const runAction = React.useCallback(async (action, options = {}) => {
      if (state.pendingAction) {
        return
      }

      const nextConfig = options.config
        ? createConfigState(options.config)
        : state.config

      setState((current) => ({
        ...current,
        config: nextConfig,
        pendingAction: action,
        feedback: "",
      }))

      try {
        const response = await fetch(state.apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(buildActionRequest(action, nextConfig, options.extraBody)),
        })
        const result = await response.json().catch(() => null)

        if (!response.ok || !result?.ok) {
          throw new Error(result?.message || "插件操作失败")
        }

        setState((current) => ({
          ...applyActionResult(current, result),
          pendingAction: "",
          feedback: result.message || "操作成功",
        }))
        sdk.toast.success(result?.message || "操作成功", "每日60s")
      } catch (error) {
        const message = error instanceof Error ? error.message : "插件操作失败"

        setState((current) => ({
          ...current,
          config: nextConfig,
          pendingAction: "",
          feedback: message,
        }))
        sdk.toast.error(message, "每日60s")
      }
    }, [sdk.toast, state.apiUrl, state.config, state.pendingAction])

    const actions = React.useMemo(() => ({
      setConfigField,
      save: () => runAction("save"),
      publishNow: () => runAction("publish-now", {
        extraBody: {
          force: true,
        },
      }),
      scheduleHoroscope: () => runAction("schedule-horoscope"),
      startTask: () => runAction("start-task", {
        config: {
          ...state.config,
          enabled: true,
        },
      }),
      stopTask: () => runAction("stop-task", {
        config: {
          ...state.config,
          enabled: false,
        },
      }),
      reschedule: () => runAction("reschedule"),
      clearRuns: () => {
        if (typeof window !== "undefined" && !window.confirm("确认清空这个插件的运行记录吗？")) {
          return
        }

        void runAction("clear-runs")
      },
    }), [runAction, setConfigField, state.config])

    return {
      state,
      actions,
    }
  }
}
