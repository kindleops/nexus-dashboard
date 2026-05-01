import { Icon } from '../../../shared/icons'

type ThreadTranslateViewMode = 'original' | 'translated'

interface ComposerTranslationBarProps {
  sellerLanguageLabel: string
  sellerLanguageCode: string | null
  isSellerLanguageEnglish: boolean
  hasInboundMessages: boolean
  hasThreadTranslations: boolean
  threadViewMode: ThreadTranslateViewMode
  isThreadTranslating: boolean
  isDraftTranslating: boolean
  hasDraftText: boolean
  translatedDraftPreview: string | null
  translationError: string | null
  canRevertDraft: boolean
  onTranslateThread: () => void
  onTranslateDraft: () => void
  onSetThreadViewMode: (mode: ThreadTranslateViewMode) => void
  onUseDraftTranslation: () => void
  onRevertDraft: () => void
}

export const ComposerTranslationBar = ({
  sellerLanguageLabel,
  sellerLanguageCode,
  isSellerLanguageEnglish,
  hasInboundMessages,
  hasThreadTranslations,
  threadViewMode,
  isThreadTranslating,
  isDraftTranslating,
  hasDraftText,
  translatedDraftPreview,
  translationError,
  canRevertDraft,
  onTranslateThread,
  onTranslateDraft,
  onSetThreadViewMode,
  onUseDraftTranslation,
  onRevertDraft,
}: ComposerTranslationBarProps) => {
  const languageMeta = sellerLanguageCode ? `${sellerLanguageLabel} (${sellerLanguageCode})` : sellerLanguageLabel

  return (
    <div className="nx-translation-bar" role="region" aria-label="Translation controls">
      <div className="nx-translation-bar__row">
        <div className="nx-translation-bar__seller-language">
          <span className="nx-translation-bar__label">Seller language</span>
          <strong>{languageMeta}</strong>
        </div>

        <div className="nx-translation-bar__actions">
          <div className="nx-translation-toggle" role="tablist" aria-label="Thread language view">
            <button
              type="button"
              role="tab"
              aria-selected={threadViewMode === 'original'}
              className={threadViewMode === 'original' ? 'is-active' : ''}
              onClick={() => onSetThreadViewMode('original')}
            >
              Original
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={threadViewMode === 'translated'}
              className={threadViewMode === 'translated' ? 'is-active' : ''}
              onClick={() => onSetThreadViewMode('translated')}
              disabled={!hasThreadTranslations}
              title={hasThreadTranslations ? 'Show translated inbound messages' : 'Translate thread to enable'}
            >
              Translated
            </button>
          </div>

          <button
            type="button"
            className="nx-translation-btn"
            disabled={isSellerLanguageEnglish || !hasInboundMessages || isThreadTranslating}
            onClick={onTranslateThread}
            title={
              isSellerLanguageEnglish
                ? 'Thread is already in English'
                : !hasInboundMessages
                  ? 'No inbound seller messages to translate'
                  : 'Translate inbound seller messages to English'
            }
          >
            <Icon name="spark" style={{ width: 14, marginRight: 6 }} />
            {isThreadTranslating ? 'Translating Thread...' : 'Translate Thread'}
          </button>

          <button
            type="button"
            className="nx-translation-btn"
            disabled={!hasDraftText || isDraftTranslating}
            onClick={onTranslateDraft}
            title={hasDraftText ? 'Translate draft to seller language' : 'Type a draft to translate'}
          >
            <Icon name="send" style={{ width: 14, marginRight: 6 }} />
            {isDraftTranslating ? 'Translating Draft...' : 'Translate Draft'}
          </button>

          {canRevertDraft && (
            <button type="button" className="nx-translation-btn is-quiet" onClick={onRevertDraft}>
              Revert Draft
            </button>
          )}
        </div>
      </div>

      {translatedDraftPreview && (
        <div className="nx-translation-draft-preview">
          <div className="nx-translation-draft-preview__header">
            <span>Translated draft ready</span>
            <button type="button" onClick={onUseDraftTranslation}>Use Translation</button>
          </div>
          <p>{translatedDraftPreview}</p>
        </div>
      )}

      {translationError && (
        <div className="nx-translation-error" role="status">
          {translationError}
        </div>
      )}

      {isSellerLanguageEnglish && (
        <div className="nx-translation-hint" role="status">
          Thread appears to be English; thread translation is unnecessary.
        </div>
      )}
    </div>
  )
}
