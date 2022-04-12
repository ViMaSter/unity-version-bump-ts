import {wait} from '../src/wait'
import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {describe, it, expect} from '@jest/globals'
import {basename} from 'path'

class VersionParser {
  static MismatchingLengthError = class extends Error {
    constructor(
      public versionString: string,
      public versionPart: string,
      public allowedMaximumLength: number,
      public actualLength: number
    ) {
      super(
        `Cannot parse version string '${versionString}': The length of the '${versionPart}' part is ${actualLength} but the maximum allowed length is ${allowedMaximumLength}`
      )
    }
  }
  static InvalidSyntaxError = class extends Error {
    constructor(public versionString: string) {
      super(`Cannot parse version string '${versionString}'`)
    }
  }

  private static readonly versionNameMatcher =
    /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?<channel>\w)?(?<build>\d+)?/
  private static readonly versionPartMaximumLength = {
    major: 4,
    minor: 2,
    patch: 2,
    channel: 1,
    build: 3
  }

  public readonly major: Number = -1
  public readonly minor: Number = -1
  public readonly patch: Number = -1
  public readonly channel?: string = undefined
  public readonly build?: Number = undefined

  constructor(versionString: string) {
    const matchAttempt = VersionParser.versionNameMatcher.exec(versionString)
    if (matchAttempt == null) {
      throw new VersionParser.InvalidSyntaxError(versionString)
    }

    Object.entries(VersionParser.versionPartMaximumLength).forEach(entry => {
      const [partName, maximumLength] = entry
      const value = matchAttempt.groups![partName]
      if (['channel', 'build'].includes(partName)) {
        if (value == null) {
          return
        }
      }
      const actualLength = matchAttempt.groups![partName].length
      if (actualLength > maximumLength) {
        throw new VersionParser.MismatchingLengthError(
          versionString,
          partName,
          maximumLength,
          actualLength
        )
      }
    })

    this.major = parseInt(matchAttempt.groups!.major)
    this.minor = parseInt(matchAttempt.groups!.minor)
    this.patch = parseInt(matchAttempt.groups!.patch)
    if (matchAttempt.groups!.channel) {
      this.channel = matchAttempt.groups!.channel
      this.build = parseInt(matchAttempt.groups!.build)
    }
  }
  isLTS(): any {
    return this.channel === 'f'
  }
  isStable(): any {
    return this.channel === undefined
  }
  isBeta(): any {
    return this.channel === 'b'
  }
  isAlpha(): any {
    return this.channel === 'a'
  }
  getComparable(): any {
    throw new Error('Method not implemented.')
  }
}

declare namespace VersionParser {
  type MismatchingLengthError =
    typeof VersionParser.MismatchingLengthError.prototype
  type InvalidSyntaxError = typeof VersionParser.InvalidSyntaxError.prototype
}

describe('version name parser', () => {
  describe('parsing', () => {
    it('parses LTS versions', async () => {
      const versionString = new VersionParser('2022.1.0f1')
      expect(versionString.isLTS()).toBeTruthy()
      expect(versionString.isStable()).toBeFalsy()
      expect(versionString.isBeta()).toBeFalsy()
      expect(versionString.isAlpha()).toBeFalsy()
      expect(versionString.major).toBe(2022)
      expect(versionString.minor).toBe(1)
      expect(versionString.patch).toBe(0)
      expect(versionString.build).toBe(1)
    })
    it('parses non-LTS versions', async () => {
      const versionString = new VersionParser('2022.2.0')
      expect(versionString.isLTS()).toBeFalsy()
      expect(versionString.isStable()).toBeTruthy()
      expect(versionString.isBeta()).toBeFalsy()
      expect(versionString.isAlpha()).toBeFalsy()
      expect(versionString.major).toBe(2022)
      expect(versionString.minor).toBe(2)
      expect(versionString.patch).toBe(0)
      expect(versionString.build).toBeUndefined()
    })
    it('parses beta versions', async () => {
      const versionString = new VersionParser('2021.3.0b15')
      expect(versionString.isLTS()).toBeFalsy()
      expect(versionString.isStable()).toBeFalsy()
      expect(versionString.isBeta()).toBeTruthy()
      expect(versionString.isAlpha()).toBeFalsy()
      expect(versionString.major).toBe(2021)
      expect(versionString.minor).toBe(3)
      expect(versionString.patch).toBe(0)
      expect(versionString.build).toBe(15)
    })
    it('parses alpha versions', async () => {
      const versionString = new VersionParser('2021.2.19a9')
      expect(versionString.isLTS()).toBeFalsy()
      expect(versionString.isStable()).toBeFalsy()
      expect(versionString.isBeta()).toBeFalsy()
      expect(versionString.isAlpha()).toBeTruthy()
      expect(versionString.major).toBe(2021)
      expect(versionString.minor).toBe(2)
      expect(versionString.patch).toBe(19)
      expect(versionString.build).toBe(9)
    })
  })
  describe('error handling', () => {
    it('throws if major version is longer than 4 characters', async () => {
      expect.assertions(2)

      const failedSetup = () => {
        new VersionParser('20221.11.11a111')
      }

      expect(failedSetup).toThrow('major')
      expect(failedSetup).toThrow('4')
    })
    it('throws if minor version is longer than 2 characters', async () => {
      expect.assertions(2)

      const failedSetup = () => {
        new VersionParser('2022.111.11a111')
      }

      expect(failedSetup).toThrow('minor')
      expect(failedSetup).toThrow('2')
    })
    it('throws if patch version is longer than 2 characters', async () => {
      expect.assertions(2)

      const failedSetup = () => {
        new VersionParser('2022.11.111a111')
      }

      expect(failedSetup).toThrow('patch')
      expect(failedSetup).toThrow('2')
    })
    it('throws if build version is longer than 3 characters', async () => {
      expect.assertions(2)

      const failedSetup = () => {
        new VersionParser('2022.11.11a1111')
      }

      expect(failedSetup).toThrow('build')
      expect(failedSetup).toThrow('3')
    })
  })
  describe('comparison', () => {
    it('can determine which version is newer across channels', async () => {
      const newestFirst: string[] = [
        '2022.2.1a9',
        '2022.2.1b15',
        '2021.1.1',
        '2021.1.09f1'
      ]
      for (let i = 1; i < newestFirst.length; i++) {
        const newest = newestFirst[i - 1]
        const oldest = newestFirst[i]
        expect(new VersionParser(newest).getComparable()).toBeGreaterThan(
          new VersionParser(oldest).getComparable()
        )
      }

      const newestFirstFlippedChannelOrder: string[] = [
        '2022.2.1f1',
        '2022.2.1',
        '2021.1.1b1',
        '2021.1.0a1'
      ]

      for (let i = 1; i < newestFirstFlippedChannelOrder.length; i++) {
        const newer = newestFirstFlippedChannelOrder[i - 1]
        const older = newestFirstFlippedChannelOrder[i]
        expect(new VersionParser(newer).getComparable()).toBeGreaterThan(
          new VersionParser(older).getComparable()
        )
      }
    })

    const newestFirstSameChannel = {
      lts: [
        '2022.2.1f1',
        '2021.2.1f1',
        '2021.1.1f1',
        '2021.1.0f1',
        '2021.1.0f0'
      ],
      'non-lts': ['2022.2.1', '2021.2.1', '2021.1.1', '2021.1.0'],
      beta: [
        '2022.2.1b1',
        '2021.2.1b1',
        '2021.1.1b1',
        '2021.1.0b1',
        '2021.1.0b0'
      ],
      alpha: [
        '2022.2.1a1',
        '2021.2.1a1',
        '2021.1.1a1',
        '2021.1.0a1',
        '2021.1.0a0'
      ]
    }

    Object.entries(newestFirstSameChannel).forEach(fixture => {
      const [channel, versions] = fixture
      const [newer, older] = versions
      it(`can determine which version is newer for same channel (${channel})`, async () => {
        expect(new VersionParser(newer).getComparable()).toBeGreaterThan(
          new VersionParser(older).getComparable()
        )
      })
    })
  })
})

describe('Unity sanity check', () => {
  it('verifies that latest LTS version of Unity follows MAJOR.MINOR.PATCHfBUILD syntax', async () => {
    throw new Error('Method not implemented.')
  })
  it('verifies that latest stable version of Unity follows MAJOR.MINOR.PATCH syntax', async () => {
    throw new Error('Method not implemented.')
  })
  it('verifies that latest beta version of Unity follows MAJOR.MINOR.PATCHbBUILD syntax', async () => {
    throw new Error('Method not implemented.')
  })
  it('verifies that latest alpha version of Unity follows MAJOR.MINOR.PATCHaBUILD syntax', async () => {
    throw new Error('Method not implemented.')
  })
})
