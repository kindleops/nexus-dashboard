/**
 * NEXUS ModelPicker — Intelligence Config Panel
 *
 * Model selection, reasoning depth, and action permission presets.
 * Compact inline component for sidecar/console copilot modes.
 */

import { useState } from 'react'
import { MODEL_OPTIONS, ACTION_PERMISSION_META } from './copilot-state'
import type { ActionPermission, ModelOption } from './copilot-state'

interface ModelPickerProps {
  model: string
  permission: ActionPermission
  onModelChange: (id: string) => void
  onPermissionChange: (p: ActionPermission) => void
}

export function ModelPicker({ model, permission, onModelChange, onPermissionChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false)

  const currentModel = MODEL_OPTIONS.find(m => m.id === model) ?? MODEL_OPTIONS[1]
  const currentPerm = ACTION_PERMISSION_META[permission]

  return (
    <div className={`nx-model-picker ${open ? 'is-open' : ''}`}>
      <button className="nx-model-picker__trigger" onClick={() => setOpen(o => !o)}>
        <span className="nx-model-picker__model-label">{currentModel.label}</span>
        <span className="nx-model-picker__divider">·</span>
        <span className="nx-model-picker__perm-label">{currentPerm.label}</span>
        <span className="nx-model-picker__chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="nx-model-picker__panel">
          <div className="nx-model-picker__section">
            <span className="nx-model-picker__section-label">Intelligence Model</span>
            <div className="nx-model-picker__options">
              {MODEL_OPTIONS.map((m: ModelOption) => (
                <button
                  key={m.id}
                  className={`nx-model-picker__option ${m.id === model ? 'is-active' : ''}`}
                  onClick={() => { onModelChange(m.id); }}
                >
                  <span className="nx-model-picker__opt-label">{m.label}</span>
                  <span className="nx-model-picker__opt-desc">{m.description}</span>
                  <span className={`nx-model-picker__speed nx-model-picker__speed--${m.speed}`}>{m.speed}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="nx-model-picker__section">
            <span className="nx-model-picker__section-label">Action Permission</span>
            <div className="nx-model-picker__options">
              {(Object.entries(ACTION_PERMISSION_META) as [ActionPermission, typeof currentPerm][]).map(([key, meta]) => (
                <button
                  key={key}
                  className={`nx-model-picker__option ${key === permission ? 'is-active' : ''}`}
                  onClick={() => { onPermissionChange(key); }}
                >
                  <span className="nx-model-picker__opt-label">{meta.label}</span>
                  <span className="nx-model-picker__opt-desc">{meta.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
