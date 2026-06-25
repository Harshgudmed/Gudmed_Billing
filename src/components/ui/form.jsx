import { createContext, useContext } from 'react'
import { Controller, FormProvider, useFormContext } from 'react-hook-form'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export const Form = FormProvider

const FormFieldContext = createContext({})
const FormItemContext = createContext({})

export function FormField(props) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

export function FormItem({ className, ...props }) {
  return (
    <FormItemContext.Provider value={{}}>
      <div className={cn('space-y-2', className)} {...props} />
    </FormItemContext.Provider>
  )
}

export function FormLabel({ className, ...props }) {
  const { name } = useContext(FormFieldContext)
  const { formState } = useFormContext()
  const error = formState.errors[name]
  return <Label className={cn(error && 'text-destructive', className)} {...props} />
}

export function FormControl({ ...props }) {
  return <div {...props} />
}

export function FormDescription({ className, ...props }) {
  return <p className={cn('text-[0.8rem] text-muted-foreground', className)} {...props} />
}

export function FormMessage({ className, children, ...props }) {
  const { name } = useContext(FormFieldContext)
  const { formState } = useFormContext()
  const error = formState.errors[name]
  const body = error ? String(error?.message ?? '') : children
  if (!body) return null
  return <p className={cn('text-[0.8rem] font-medium text-destructive', className)} {...props}>{body}</p>
}
