"use client"

import type { AccessThresholdOption } from "@/lib/access-threshold-options"
import { ConditionValueField, type ConditionValueFieldMode } from "@/components/condition-value-field"
import { getLotteryConditionPlaceholder } from "@/components/post/create-post-form.shared"

interface LotteryConditionValueFieldProps {
  conditionType: string
  value: string
  pointName: string
  userLevelOptions: AccessThresholdOption[]
  vipLevelOptions: AccessThresholdOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

function getLotteryConditionValueMode(conditionType: string): ConditionValueFieldMode {
  if (conditionType === "USER_LEVEL") {
    return "user-level"
  }

  if (conditionType === "VIP_LEVEL") {
    return "vip-level"
  }

  if (conditionType === "USER_POST_COUNT" || conditionType === "DAILY_POST_COUNT" || conditionType === "DAILY_COMMENT_COUNT") {
    return "number"
  }

  return "text"
}

export function LotteryConditionValueField({
  conditionType,
  value,
  pointName,
  userLevelOptions,
  vipLevelOptions,
  onChange,
  disabled = false,
}: LotteryConditionValueFieldProps) {
  return (
    <ConditionValueField
      mode={getLotteryConditionValueMode(conditionType)}
      value={value}
      className="h-11 rounded-full border border-border bg-background px-4 text-sm outline-hidden"
      placeholder={getLotteryConditionPlaceholder(conditionType, pointName)}
      userLevelOptions={userLevelOptions}
      vipLevelOptions={vipLevelOptions}
      onChange={onChange}
      disabled={disabled}
    />
  )
}
