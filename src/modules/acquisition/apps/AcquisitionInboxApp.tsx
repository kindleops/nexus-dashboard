import { AcquisitionAppShell } from '../components/AcquisitionAppShell'
import { InboxPage } from '../../inbox/InboxPage'
import type { AcquisitionWorkspaceModel } from '../acquisition.types'
import type { InboxModel } from '../../inbox/inbox.adapter'

interface AcquisitionInboxAppProps {
  data: AcquisitionWorkspaceModel & { inboxData: InboxModel }
}

export const AcquisitionInboxApp = ({ data }: AcquisitionInboxAppProps) => {
  return (
    <AcquisitionAppShell
      breadcrumb="Seller Inbox"
      appName="Seller Inbox"
      appDescription="Hot replies and negotiations with acquisition focus"
      appStatus={`From Acquisition`}
    >
      <div className="acq-app-body-full">
        <InboxPage data={data.inboxData} />
      </div>
    </AcquisitionAppShell>
  )
}
