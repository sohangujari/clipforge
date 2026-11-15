import { NewProjectForm } from '@/components/cf/NewProjectForm'

export default function NewProjectPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">Add a long video and choose how clips should be found.</p>
      </div>
      <NewProjectForm />
    </div>
  )
}
