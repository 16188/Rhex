import {
  findBoardLabel,
  formatDateTime,
  formatTagsValue,
  getScheduleStatusLabel,
  getStatusLabel,
} from "./daily-60s-admin.model.js?v=1.1.6"

export function createDaily60sAdminView(sdk) {
  const { React, ui, custom } = sdk
  const {
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
  } = ui
  const { BoardSelectField } = custom
  const h = React.createElement

  function StatusCard({ title, value, detail }) {
    return h(
      Card,
      {
        className: "bg-muted/20",
      },
      h(
        CardContent,
        {
          className: "flex flex-col gap-2 p-4",
        },
        h("span", {
          className: "text-xs text-muted-foreground",
        }, title),
        h("strong", {
          className: "text-sm font-semibold text-foreground",
        }, value),
        detail
          ? h("p", {
            className: "text-xs leading-6 text-muted-foreground",
          }, detail)
          : null,
      ),
    )
  }

  function FieldBlock({ label, description, children }) {
    return h("div", {
      className: "flex flex-col gap-2",
    },
    h("div", {
      className: "flex flex-col gap-1",
    },
    h("p", {
      className: "text-sm font-medium text-foreground",
    }, label),
    description
      ? h("p", {
        className: "text-xs leading-6 text-muted-foreground",
      }, description)
      : null),
    children,
    )
  }

  function RunItem({ item }) {
    return h(
      Card,
      {
        className: "border-border/70",
      },
      h(
        CardContent,
        {
          className: "flex flex-col gap-3 p-4",
        },
        h(
          "div",
          {
            className: "flex flex-wrap items-center justify-between gap-2",
          },
          h(Badge, {
            variant: "outline",
          }, getStatusLabel(item.status)),
          h("span", {
            className: "text-xs text-muted-foreground",
          }, item.trigger || "unknown"),
        ),
        h("p", {
          className: "text-sm leading-6 text-foreground",
        }, item.message || "无"),
        h(
          "div",
          {
            className: "flex flex-wrap gap-3 text-xs text-muted-foreground",
          },
          h("span", null, `执行时间：${formatDateTime(item.executedAt)}`),
          h("span", null, `数据日期：${item.dataDate || "无"}`),
          item.postSlug
            ? h("span", null, `帖子 slug：${item.postSlug}`)
            : null,
        ),
      ),
    )
  }

  return function Daily60sAdminView({ controller }) {
    const { state, actions } = controller
    const { config, runtimeState, scheduleState, runs, boardOptions, pendingAction, feedback } = state
    const boardLabel = findBoardLabel(boardOptions, config.boardSlug)
    const scheduleStatus = scheduleState.state || scheduleState.status || ""
    const tagsValue = formatTagsValue(config.tags)
    const hasBoardOptions = Array.isArray(boardOptions) && boardOptions.length > 0

    return h(
      "div",
      {
        className: "flex flex-col gap-6",
      },
      h(
        "section",
        {
          key: "overview",
          className: "flex flex-col gap-6",
        },
        h(
          "div",
          {
            className: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
          },
          h("div", {
            className: "flex flex-col gap-1",
          },
          h("h2", {
            className: "text-lg font-semibold text-foreground",
          }, "每日60s 自动发帖"),
          h("p", {
            className: "text-sm leading-6 text-muted-foreground",
          }, "插件会从外部数据源拉取“60 秒看世界”内容，并按你配置的时间、账号、节点和发帖状态自动发布。"),
          h("a", {
            href: state.docsUrl || state.dataSourceUrl || "#",
            target: "_blank",
            rel: "noreferrer",
            className: "text-xs text-primary underline-offset-4 hover:underline",
          }, state.dataSourceUrl || "查看数据源")),
          h(
            "div",
            {
              className: "flex flex-wrap gap-2",
            },
            h(Button, {
              key: "clearRuns",
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: Boolean(pendingAction),
              onClick: actions.clearRuns,
            }, "清空运行记录"),
            h(Button, {
              key: "startTask",
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: Boolean(pendingAction) || Boolean(config.enabled),
              onClick: actions.startTask,
            }, pendingAction === "start-task" ? "启动中..." : "启动任务"),
            h(Button, {
              key: "stopTask",
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: Boolean(pendingAction) || !config.enabled,
              onClick: actions.stopTask,
            }, pendingAction === "stop-task" ? "停止中..." : "停止任务"),
            h(Button, {
              key: "reschedule",
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: Boolean(pendingAction) || !config.enabled,
              onClick: actions.reschedule,
            }, "重新挂起调度"),
            h(Button, {
              key: "publishNow",
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: Boolean(pendingAction),
              onClick: actions.publishNow,
            }, "立即发布一次"),
            h(Button, {
              key: "scheduleHoroscope",
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: Boolean(pendingAction),
              onClick: actions.scheduleHoroscope,
            }, pendingAction === "schedule-horoscope" ? "启动中..." : "立即测试星座"),
            h(Button, {
              key: "save",
              type: "button",
              size: "sm",
              disabled: Boolean(pendingAction),
              onClick: actions.save,
            }, pendingAction === "save" ? "保存中..." : "保存配置"),
          ),
        ),
        h(
          "section",
          {
            className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4",
          },
          h(StatusCard, {
            title: "自动发布",
            value: config.enabled ? "已开启" : "已关闭",
            detail: config.enabled ? "当前会按调度自动尝试发布" : "仅支持手动发布与保存配置",
          }),
          h(StatusCard, {
            title: "下一次计划时间",
            value: formatDateTime(runtimeState.nextRunAt),
            detail: runtimeState.scheduledJobId ? `挂起任务 ID：${runtimeState.scheduledJobId}` : "当前没有挂起任务",
          }),
          h(StatusCard, {
            title: "调度状态",
            value: getScheduleStatusLabel(scheduleStatus),
            detail: scheduleState.message || "宿主会用统一后台任务调度下一次执行",
          }),
          h(StatusCard, {
            title: "最近一次结果",
            value: getStatusLabel(runtimeState.lastResult),
            detail: runtimeState.lastMessage
              || (runtimeState.lastPublishedDate
              ? `最近发布日期：${runtimeState.lastPublishedDate}`
              : "当前还没有成功发布记录"),
          }),
          h(StatusCard, {
            title: "星座运势计划时间",
            value: runtimeState.lastHoroscopeResult === "PROCESSING"
              ? "正在执行"
              : formatDateTime(runtimeState.horoscopeNextRunAt),
            detail: runtimeState.horoscopeScheduledJobId
              ? `挂起任务 ID：${runtimeState.horoscopeScheduledJobId}`
              : "每日资讯发布后 10 分钟自动挂起",
          }),
          h(StatusCard, {
            title: "最近星座运势",
            value: getStatusLabel(runtimeState.lastHoroscopeResult),
            detail: runtimeState.lastHoroscopeMessage
              || (runtimeState.lastHoroscopePublishedDate
              ? `最近发布日期：${runtimeState.lastHoroscopePublishedDate}`
              : "当前还没有成功发布记录"),
          }),
        ),
        h(
          "div",
          {
            className: "rounded-xl border border-border bg-secondary/20 p-4 text-sm leading-6 text-muted-foreground",
          },
          "自动发布依赖后台任务 worker 持续运行。标题模板支持 ",
          h("code", null, "{{date}}"),
          " 占位符；发布状态支持 ",
          h("code", null, "AUTO"),
          "（跟随节点设置）、",
          h("code", null, "PUBLISHED"),
          "（立即发布）、",
          h("code", null, "PENDING"),
          "（进入审核）。每日资讯发布成功后，十二星座今日运势会在 10 分钟后发布；点击“停止任务”会同时取消尚未执行的资讯和星座任务。",
        ),
        scheduleState.message
          ? h(
            "div",
            {
              className: "rounded-xl border border-border bg-background p-4 text-sm leading-6 text-muted-foreground",
            },
            `当前调度状态：${scheduleState.message}`,
          )
          : null,
      ),
      h(
        Card,
        {
          key: "config",
        },
        null,
        h(
          CardHeader,
          {
            className: "border-b",
          },
          h(CardTitle, null, "发布配置"),
          h(CardDescription, null, "前后台 UI 优先复用宿主系统组件；这里只在宿主没有对应模式时使用少量自定义布局类。"),
        ),
        h(
          CardContent,
          {
            className: "grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-3",
          },
          h(
            FieldBlock,
            {
              key: "enabled",
              label: "自动发布开关",
              description: "关闭后不会再自动挂起后续任务。",
            },
            h(
              "div",
              {
                className: "flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2",
              },
              h("span", {
                className: "text-sm text-foreground",
              }, config.enabled ? "开启" : "关闭"),
              h(Switch, {
                checked: Boolean(config.enabled),
                disabled: Boolean(pendingAction),
                onCheckedChange: (checked) => actions.setConfigField("enabled", Boolean(checked)),
              }),
            ),
          ),
          h(
            FieldBlock,
            {
              key: "boardSlug",
              label: "目标节点",
              description: hasBoardOptions ? "通过宿主公开的节点选择器选择目标节点。" : "当前没有可用节点选项。",
            },
            typeof BoardSelectField === "function"
              ? h(BoardSelectField, {
                boardOptions,
                value: config.boardSlug,
                onChange: (value) => actions.setConfigField("boardSlug", value),
                disabled: Boolean(pendingAction) || !hasBoardOptions,
                placeholder: "请选择目标节点",
                title: "选择目标节点",
                description: "支持按分区、节点名或 slug 搜索，保存后会把所选节点 slug 写入插件配置。",
              })
              : h(Input, {
                value: config.boardSlug,
                disabled: Boolean(pendingAction),
                placeholder: "请输入目标节点 slug",
                onChange: (event) => actions.setConfigField("boardSlug", event.target.value),
              }),
            h("p", {
              className: "text-xs leading-6 text-muted-foreground",
            }, `当前目标：${boardLabel}`),
          ),
          h(
            FieldBlock,
            {
              key: "authorUsername",
              label: "发布账号用户名",
              description: "发帖时会按这个用户名查找宿主账号。",
            },
            h(Input, {
              value: config.authorUsername,
              disabled: Boolean(pendingAction),
              placeholder: "例如 admin",
              onChange: (event) => actions.setConfigField("authorUsername", event.target.value),
            }),
          ),
          h(
            FieldBlock,
            {
              key: "publishTime",
              label: "每日发布时间",
              description: "使用 24 小时制时间，例如 08:00。",
            },
            h(Input, {
              value: config.publishTime,
              disabled: Boolean(pendingAction),
              placeholder: "08:00",
              onChange: (event) => actions.setConfigField("publishTime", event.target.value),
            }),
          ),
          h(
            FieldBlock,
            {
              key: "timeZone",
              label: "时区",
              description: "默认使用 Asia/Shanghai。",
            },
            h(Input, {
              value: config.timeZone,
              disabled: Boolean(pendingAction),
              placeholder: "Asia/Shanghai",
              onChange: (event) => actions.setConfigField("timeZone", event.target.value),
            }),
          ),
          h(
            FieldBlock,
            {
              key: "publishStatus",
              label: "发布状态",
              description: "AUTO 跟随节点设置，PUBLISHED 立即发布，PENDING 进入审核。",
            },
            h(
              Select,
              {
                value: config.publishStatus,
                onValueChange: (value) => actions.setConfigField("publishStatus", value),
                disabled: Boolean(pendingAction),
              },
              h(
                SelectTrigger,
                null,
                h(SelectValue, {
                  placeholder: "选择发布状态",
                }),
              ),
              h(
                SelectContent,
                null,
                h(
                  SelectGroup,
                  null,
                  h(SelectItem, { value: "AUTO" }, "AUTO"),
                  h(SelectItem, { value: "PUBLISHED" }, "PUBLISHED"),
                  h(SelectItem, { value: "PENDING" }, "PENDING"),
                ),
              ),
            ),
          ),
          h(
            FieldBlock,
            {
              key: "titleTemplate",
              label: "标题模板",
              description: "支持使用 {{date}} 占位符。",
            },
            h(Input, {
              value: config.titleTemplate,
              disabled: Boolean(pendingAction),
              placeholder: "【每日60s】{{date}}",
              onChange: (event) => actions.setConfigField("titleTemplate", event.target.value),
            }),
          ),
          h(
            FieldBlock,
            {
              key: "tags",
              label: "标签（逗号分隔）",
              description: "插件会把这些标签作为手动标签写入帖子。",
            },
            h(Input, {
              value: tagsValue,
              disabled: Boolean(pendingAction),
              placeholder: "每日60s, 资讯",
              onChange: (event) => actions.setConfigField("tags", event.target.value),
            }),
          ),
          h(
            FieldBlock,
            {
              key: "lastPostSlug",
              label: "最近帖子",
              description: "显示最近一次成功创建的帖子 slug。",
            },
            h(Input, {
              value: runtimeState.lastPostSlug || "暂无",
              disabled: true,
            }),
          ),
        ),
      ),
      h(
        Card,
        {
          key: "runs",
        },
        null,
        h(
          CardHeader,
          {
            className: "border-b",
          },
          h(CardTitle, null, "运行记录"),
          h(CardDescription, null, `最近执行：${formatDateTime(runtimeState.lastRunAt)}`),
        ),
        h(
          CardContent,
          {
            className: "flex flex-col gap-3 pt-6",
          },
          runs.length > 0
            ? runs.map((item, index) => h(RunItem, {
              key: `${item.executedAt || "run"}-${index}`,
              item,
            }))
            : h(
              "div",
              {
                className: "rounded-xl border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground",
              },
              "当前还没有运行记录。",
            ),
          feedback
            ? h(
              "p",
              {
                className: "text-xs leading-6 text-muted-foreground",
              },
              feedback,
            )
            : null,
        ),
      ),
    )
  }
}
