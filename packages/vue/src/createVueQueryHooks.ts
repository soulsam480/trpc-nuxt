import {
  CreateTRPCClientOptions,
  TRPCClient,
  TRPCClientErrorLike,
  TRPCRequestOptions,
  createTRPCClient,
} from '@trpc/client'
import type {
  AnyRouter,
  ProcedureRecord,
  inferHandlerInput,
  inferProcedureInput,
  inferProcedureOutput,
  inferSubscriptionOutput,
} from '@trpc/server'
// import React, { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  QueryClient,
  UseQueryOptions,
  useInfiniteQuery as __useInfiniteQuery,
  useMutation as __useMutation,
  useQuery as __useQuery,
  UseMutationReturnType,
  UseQueryReturnType,
} from 'vue-query'
import {
  UseInfiniteQueryResult,
  UseMutationResult,
  UseQueryResult,
  hashQueryKey,
  UseInfiniteQueryOptions,
  UseMutationOptions,
} from 'react-query'
import { DehydratedState } from 'react-query/hydration'
import { SSRState, TRPCContextKey, TRPCContextState } from './internals/context'
import { App, inject, onMounted, reactive, ref, toRefs, unref, watchEffect } from 'vue'
import { MaybeRef } from 'vue-query/lib/vue/types'

export type OutputWithCursor<TData, TCursor extends any = any> = {
  cursor: TCursor | null
  data: TData
}

export interface TRPCUseQueryBaseOptions extends TRPCRequestOptions {
  /**
   * Opt out of SSR for this query by passing `ssr: false`
   */
  ssr?: boolean
}

export interface UseTRPCQueryOptions<TPath, TInput, TOutput, TError>
  extends UseQueryOptions<TOutput, TError, TOutput, [TPath, TInput]>,
    TRPCUseQueryBaseOptions {}

export interface UseTRPCInfiniteQueryOptions<TPath, TInput, TOutput, TError>
  extends UseInfiniteQueryOptions<TOutput, TError, TOutput, TOutput, [TPath, TInput]>,
    TRPCUseQueryBaseOptions {}

export interface UseTRPCMutationOptions<TInput, TError, TOutput>
  extends UseMutationOptions<TOutput, TError, TInput>,
    TRPCUseQueryBaseOptions {}

function getClientArgs<TPathAndInput extends unknown[], TOptions>(pathAndInput: TPathAndInput, opts: TOptions) {
  const [path, input] = pathAndInput
  return [path, input, opts] as const
}

type inferInfiniteQueryNames<TObj extends ProcedureRecord<any, any, any, any, any, any>> = {
  [TPath in keyof TObj]: inferProcedureInput<TObj[TPath]> extends {
    cursor?: any
  }
    ? TPath
    : never
}[keyof TObj]

type inferProcedures<TObj extends ProcedureRecord<any, any, any, any, any, any>> = {
  [TPath in keyof TObj]: {
    input: inferProcedureInput<TObj[TPath]>
    output: inferProcedureOutput<TObj[TPath]>
  }
}

export function createReactQueryHooks<TRouter extends AnyRouter, TSSRContext = unknown>() {
  type TQueries = TRouter['_def']['queries']
  type TSubscriptions = TRouter['_def']['subscriptions']
  type TError = TRPCClientErrorLike<TRouter>
  type TInfiniteQueryNames = inferInfiniteQueryNames<TQueries>

  type TQueryValues = inferProcedures<TRouter['_def']['queries']>
  type TMutationValues = inferProcedures<TRouter['_def']['mutations']>

  type ProviderContext = TRPCContextState<TRouter, TSSRContext>

  function createClient(opts: CreateTRPCClientOptions<TRouter>): TRPCClient<TRouter> {
    return createTRPCClient(opts)
  }

  function TRPCProvider(props: {
    queryClient: QueryClient
    client: TRPCClient<TRouter>
    app: App
    /**
     * @deprecated
     */
    isPrepass?: boolean
    ssrContext?: TSSRContext | null
    ssrState?: SSRState
  }) {
    const { client, queryClient, ssrContext, app } = props
    const ssrState = ref<SSRState>(props.ssrState || (props.isPrepass ? 'prepass' : false))
    onMounted(() => {
      // Only updating state to `mounted` if we are using SSR.
      // This makes it so we don't have an unnecessary re-render when opting out of SSR.
      ssrState.value = ssrState.value ? 'mounted' : false
    })

    const provideState = reactive<ProviderContext>({
      queryClient,
      client,
      isPrepass: ssrState.value === 'prepass',
      ssrContext: ssrContext || null,
      ssrState,
      fetchQuery(pathAndInput, opts) {
        return queryClient.fetchQuery(
          pathAndInput as any,
          () => (client as any).query(...getClientArgs(pathAndInput, opts)),
          opts as any,
        )
      },
      fetchInfiniteQuery(pathAndInput, opts) {
        return queryClient.fetchInfiniteQuery(
          pathAndInput as any,
          ({ pageParam }) => {
            const [path, input] = pathAndInput
            const actualInput = { ...(input as any), cursor: pageParam }
            return (client as any).query(...getClientArgs([path, actualInput], opts))
          },
          opts as any,
        )
      },
      prefetchQuery(pathAndInput, opts) {
        return queryClient.prefetchQuery(
          pathAndInput as any,
          () => (client as any).query(...getClientArgs(pathAndInput, opts)),
          opts as any,
        )
      },
      prefetchInfiniteQuery(pathAndInput, opts) {
        return queryClient.prefetchInfiniteQuery(
          pathAndInput as any,
          ({ pageParam }) => {
            const [path, input] = pathAndInput
            const actualInput = { ...(input as any), cursor: pageParam }
            return (client as any).query(...getClientArgs([path, actualInput], opts))
          },
          opts as any,
        )
      },
      /**
       * @deprecated use `invalidateQueries`
       */
      invalidateQuery(...args: any[]) {
        return queryClient.invalidateQueries(...args)
      },
      invalidateQueries(...args: any[]) {
        return queryClient.invalidateQueries(...args)
      },
      refetchQueries(...args: any[]) {
        return queryClient.refetchQueries(...args)
      },
      cancelQuery(pathAndInput) {
        return queryClient.cancelQueries(pathAndInput)
      },
      setQueryData(...args) {
        return queryClient.setQueryData(...args)
      },
      getQueryData(...args) {
        return queryClient.getQueryData(...args)
      },
      setInfiniteQueryData(...args) {
        return queryClient.setQueryData(...args)
      },
      getInfiniteQueryData(...args) {
        return queryClient.getQueryData(...args)
      },
    })

    app.provide(TRPCContextKey, provideState)
  }

  function useContext() {
    const context = inject(TRPCContextKey) as ProviderContext

    return toRefs(context)
  }

  /**
   * Hack to make sure errors return `status`='error` when doing SSR
   * @link https://github.com/trpc/trpc/pull/1645
   */
  function useSSRQueryOptionsIfNeeded<TOptions extends { retryOnMount?: boolean } | undefined>(
    pathAndInput: unknown[],
    opts: TOptions,
  ): TOptions {
    const { queryClient, ssrState } = useContext()

    return ssrState &&
      ssrState.value !== 'mounted' &&
      queryClient.value.getQueryCache().find(pathAndInput)?.state.status === 'error'
      ? {
          retryOnMount: false,
          ...opts,
        }
      : opts
  }

  function useQuery<TPath extends keyof TQueryValues & string>(
    pathAndInput: [path: TPath, ...args: inferHandlerInput<TQueries[TPath]>],
    opts?: MaybeRef<UseTRPCQueryOptions<TPath, TQueryValues[TPath]['input'], TQueryValues[TPath]['output'], TError>>,
  ): UseQueryReturnType<TQueryValues[TPath]['output'], TError> {
    const { client, isPrepass, queryClient, prefetchQuery } = useContext()

    opts = opts !== undefined ? unref(opts) : opts

    if (
      typeof window === 'undefined' &&
      isPrepass &&
      opts?.ssr !== false &&
      opts?.enabled !== false &&
      !queryClient.value.getQueryCache().find(pathAndInput)
    ) {
      prefetchQuery.value(pathAndInput as any, opts as any)
    }

    const actualOpts = useSSRQueryOptionsIfNeeded(
      pathAndInput,
      opts?.retryOnMount ? { retryOnMount: unref(opts?.retryOnMount) } : undefined,
    )

    return __useQuery(pathAndInput, () => client.value.query(...getClientArgs(pathAndInput, actualOpts)), actualOpts)
  }

  function useMutation<TPath extends keyof TMutationValues & string>(
    path: TPath | [TPath],
    opts?: UseTRPCMutationOptions<TMutationValues[TPath]['input'], TError, TMutationValues[TPath]['output']>,
  ): UseMutationResult<TMutationValues[TPath]['output'], TError, TMutationValues[TPath]['input']> {
    const { client } = useContext()

    return __useMutation((input) => {
      const actualPath = Array.isArray(path) ? path[0] : path
      return (client.value.mutation as any)(actualPath, input, opts)
    }, opts)
  }

  /* istanbul ignore next */
  /**
   * ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
   *  **Experimental.** API might change without major version bump
   * ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠
   */
  function useSubscription<
    TPath extends keyof TSubscriptions & string,
    TOutput extends inferSubscriptionOutput<TRouter, TPath>,
  >(
    pathAndInput: [path: TPath, ...args: inferHandlerInput<TSubscriptions[TPath]>],
    opts: {
      enabled?: boolean
      onError?: (err: TError) => void
      onNext: (data: TOutput) => void
    },
  ) {
    const enabled = opts?.enabled ?? true
    const queryKey = hashQueryKey(pathAndInput)
    const { client } = useContext()

    return watchEffect(() => {
      if (!enabled) {
        return
      }
      const [path, input] = pathAndInput
      let isStopped = false
      const unsub = client.value.subscription(path, (input ?? undefined) as any, {
        onError: (err) => {
          if (!isStopped) {
            opts.onError?.(err)
          }
        },
        onNext: (res) => {
          if (res.type === 'data' && !isStopped) {
            opts.onNext(res.data)
          }
        },
      })
      return () => {
        isStopped = true
        unsub()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })
  }

  function useInfiniteQuery<TPath extends TInfiniteQueryNames & string>(
    pathAndInput: [path: TPath, input: Omit<TQueryValues[TPath]['input'], 'cursor'>],
    opts?: UseTRPCInfiniteQueryOptions<
      TPath,
      Omit<TQueryValues[TPath]['input'], 'cursor'>,
      TQueryValues[TPath]['output'],
      TError
    >,
  ): UseInfiniteQueryResult<TQueryValues[TPath]['output'], TError> {
    const [path, input] = pathAndInput
    const { client, isPrepass, prefetchInfiniteQuery, queryClient } = useContext()

    if (
      typeof window === 'undefined' &&
      isPrepass &&
      opts?.ssr !== false &&
      opts?.enabled !== false &&
      !queryClient.value.getQueryCache().find(pathAndInput)
    ) {
      prefetchInfiniteQuery.value(pathAndInput as any, opts as any)
    }

    const actualOpts = useSSRQueryOptionsIfNeeded(pathAndInput, opts)

    return __useInfiniteQuery(
      pathAndInput as any,
      ({ pageParam }) => {
        const actualInput = { ...((input as any) ?? {}), cursor: pageParam }
        return (client as any).query(...getClientArgs([path, actualInput], actualOpts))
      },
      actualOpts,
    )
  }
  function useDehydratedState(client: TRPCClient<TRouter>, trpcState: DehydratedState | undefined) {
    const transformed: DehydratedState | undefined = useMemo(() => {
      if (!trpcState) {
        return trpcState
      }

      return client.runtime.transformer.deserialize(trpcState)
    }, [client, trpcState])
    return transformed
  }

  return {
    // Provider: TRPCProvider,
    createClient,
    useContext,
    useQuery,
    useMutation,
    useSubscription,
    useDehydratedState,
    useInfiniteQuery,
  }
}
