import fs from 'fs';
import { completedPlaylists, playlistIds, lastPlaylistTracks, shuffledMasterPlaylist, shuffledPlaylists } from './data'
import spotifyApi from './auth';

export const waitForAccessToken = async () => {
    if (!spotifyApi.getAccessToken()) setTimeout(await waitForAccessToken, 100);
    else return Promise.resolve(true);
}

export const writeToDataFile = (playlistIds: string[], playlistTracks: string[], completedPlaylists: string[], shuffledMasterPlaylist: string[], shuffledPlaylists: { [key: string]: string[] }) => {
    fs.writeFileSync('data.ts', `export const playlistIds: string[] = ${JSON.stringify(playlistIds, null, 4)}

export const lastPlaylistTracks: string[] = ${JSON.stringify(playlistTracks, null, 4)}

export const completedPlaylists: string[] = ${JSON.stringify(completedPlaylists, null, 4)}

export const shuffledMasterPlaylist: string[] = ${JSON.stringify(shuffledMasterPlaylist, null, 4)}

export const shuffledPlaylists: { [key: string]: string[] } = ${JSON.stringify(shuffledPlaylists, null, 4)}`);
}

export const retryRequest = async (err: any, failCount: number) => {
    console.error(typeof (err as any).message === 'object' ? JSON.stringify((err as any).message) : err.message ? err.message : typeof err === 'object' ? JSON.stringify(err) : err);
    const waitTime = Math.pow(2, failCount) * 1000;
    console.log('Rate limit hit. Waiting', waitTime / 1000, 'seconds and trying again.')
    await new Promise((resolve) => setTimeout(resolve, waitTime));
}

export const calculateTotalTracks = async (playlistIds: string[]) => {
    let totalTracks = 0;
    const batchedIds: string[][] = [];

    for (let i = 0; i < playlistIds.length; i += 5) {
        batchedIds.push(playlistIds.slice(i, i + 5));
    }

    const promises = batchedIds.map(async (idsBatch, batchIndex) => {
        const startIndex = batchIndex * 5;
        const batchPromises: Promise<number>[] = [];

        idsBatch.forEach(async (playlistId, index) => {
            const playlistIndex = startIndex + index + 1;
            console.log('Getting total tracks for playlist', playlistIndex, 'of', playlistIds.length);
            const playlistTotal = await spotifyApi.getPlaylist(playlistId).then(res => res.body.tracks.total);
            console.log('Got total tracks for playlist', playlistIndex, 'of', playlistIds.length, '. Total:', playlistTotal);
            batchPromises.push(Promise.resolve(playlistTotal));
        });

        console.log('Waiting for batch promises to resolve...')
        const resolvedBatchPromises = await Promise.all(batchPromises);
        return resolvedBatchPromises.reduce((acc, curr) => acc + curr, 0);
    });

    const batchedResults = await Promise.all(promises);
    totalTracks = batchedResults.reduce((acc, curr) => acc + curr, 0);

    console.log('Got total tracks for all playlists. Total:', totalTracks);
    return totalTracks;
};



export const getPlaylistTracks = async (playlistIds: string[]) => {
    console.log('Getting tracks from', playlistIds.length, 'playlists...')
    const totalTracks = await calculateTotalTracks(playlistIds);

    const totalPlaylistTracksResults: string[] = [...lastPlaylistTracks];
    console.log('Total tracks from last run:', totalPlaylistTracksResults.length)
    const completedPlaylistsArr: string[] = completedPlaylists;
    for (let i = 0; i < playlistIds.length; i++) {
        const playlistTracksResults: string[] = [];
        let failCount = 0;
        const playlistTotal = (await spotifyApi.getPlaylist(playlistIds[i])).body.tracks.total;
        if (completedPlaylistsArr.includes(playlistIds[i])) continue;
        console.log('Playlist total:', playlistTotal)
        console.log('Getting tracks for playlist', i + 1, 'of', playlistIds.length)
        for (let j = 0; j < Math.ceil(playlistTotal / 50); j += 10) {
            const promises = [];
            for (let k = 0; k < 10; k++) {
                const offset = (j + k) * 50;
                if (offset >= playlistTotal) break;
                console.log('Getting tracks', offset + 1, 'to', offset + 50, 'for playlist', i + 1, 'of', playlistIds.length);
                const promise = spotifyApi.getPlaylistTracks(playlistIds[i], { limit: 50, offset });
                promises.push(promise);
            }

            try {
                const responses = await Promise.all(promises);
                for (const response of responses) playlistTracksResults.push(...response.body.items.map((item) => item.track!.uri));
                if (promises.length < 10) break;
            }
            catch (err) {
                await retryRequest(err, failCount);
                failCount++;
                j -= 10;
                continue;
            }
        }

        console.log('Got a total of', playlistTracksResults.length, 'tracks from playlist', i + 1, 'of', playlistIds.length, '. Expected', playlistTotal)
        console.log('playlistTracksResults.length === playlistTotal:', playlistTracksResults.length === playlistTotal)
        if (playlistTracksResults.length !== playlistTotal) {
            console.error('There was an error getting all tracks from playlist', i + 1, 'of', playlistIds.length, 'Exiting...')
            return [];
        }

        completedPlaylists.push(playlistIds[i]);
        totalPlaylistTracksResults.push(...playlistTracksResults);
        writeToDataFile(playlistIds, totalPlaylistTracksResults, completedPlaylists, shuffledMasterPlaylist, shuffledPlaylists);
    }

    console.log('Got a total of', totalPlaylistTracksResults.length, 'tracks from all playlists. Expected', totalTracks)
    console.log('playlistTracksResults.length === totalTracks:', totalPlaylistTracksResults.length === totalTracks)
    return totalPlaylistTracksResults;
}


export const confirmAllPlaylistsWereAdded = async (playlistIds: string[], completedPlaylists: string[]) => {
    return playlistIds.every((playlistId) => completedPlaylists.includes(playlistId));
}

export const shuffleMasterPlaylist = (playlistTracks: string[]) => {
    if (playlistTracks.length === 0) {
        console.error('No tracks were found. Exiting...')
        return [];
    };
    if (playlistTracks.length === shuffleMasterPlaylist.length) {
        console.error('All tracks were already shuffled. Exiting...')
        return shuffledMasterPlaylist;
    };

    const newShuffledMasterPlaylist: string[] = [];
    const playlistTracksCopy = [...playlistTracks];
    while (playlistTracksCopy.length > 0) {
        const randomIndex = Math.floor(Math.random() * playlistTracksCopy.length);
        newShuffledMasterPlaylist.push(playlistTracksCopy[randomIndex]);
        playlistTracksCopy.splice(randomIndex, 1);
    }
    writeToDataFile(playlistIds, lastPlaylistTracks, completedPlaylists, newShuffledMasterPlaylist, shuffledPlaylists);
    return newShuffledMasterPlaylist;
}

export const createNewPlaylist = async (playlistName: string): Promise<any> => {
    try {
        return await spotifyApi.createPlaylist(playlistName, { public: false });
    }
    catch (err) {
        await retryRequest(err, 0);
        return createNewPlaylist(playlistName);
    }
}

export const addTracksToLocalPlaylist = (shuffledPlaylists: { [key: string]: string[] }, shuffledTracks: string[], playlistName: string, offset: number): { [key: string]: string[] } => {
    const newShuffledPlaylists: { [key: string]: string[] } = { ...shuffledPlaylists };
    const newShuffledTracks: string[] = [...shuffledTracks];
    // Create new Spotify playlist
    let newPlaylist: string[] = [];

    for (let i = offset; i < shuffledTracks.length; i++) {
        if (newPlaylist.length >= 10000) {
            console.log('Reached the 10000 song limit for a playlist. Using next playlist...')
            newShuffledPlaylists[playlistName] = newPlaylist;
            writeToDataFile(playlistIds, lastPlaylistTracks, completedPlaylists, shuffledMasterPlaylist, newShuffledPlaylists);
            const newPlaylistName = `${playlistName} ${offset / 10000 + 1}`
            return addTracksToLocalPlaylist(newShuffledPlaylists, newShuffledTracks, newPlaylistName, i);
        }
        else {
            newPlaylist.push(shuffledTracks[i]);
            newShuffledTracks.splice(i, 1);
        }
    }

    console.log('Reached the end of the shuffled tracks array. Finishing up...')
    newShuffledPlaylists[playlistName] = newPlaylist;
    writeToDataFile(playlistIds, lastPlaylistTracks, completedPlaylists, shuffledMasterPlaylist, newShuffledPlaylists);
    return newShuffledPlaylists;
}

export const addTracksToSpotifyPlaylist = async (shuffledPlaylists: { [key: string]: string[] }, playlistName: string) => {
    for (let i = 0; i < Object.keys(shuffledPlaylists).length; i++) {
        const promises = [];
        const newPlaylist = await createNewPlaylist(`${playlistName} ${i + 1}`);
        for (let j = 0; j < 100; j++) {
            const promise = spotifyApi.addTracksToPlaylist(newPlaylist.body.id, shuffledPlaylists[Object.keys(shuffledPlaylists)[i]].slice(j * 100, j * 100 + 100));
            promises.push(promise);
        }

        for (let i = 0; i < promises.length; i += 10) {
            console.log('Adding tracks', (i * 100) + 1, 'to', (i + 10) * 100, 'of', shuffledPlaylists[Object.keys(shuffledPlaylists)[i]].length, 'to playlist', newPlaylist.body.name)
            try {
                await Promise.all(promises.slice(i, i + 10));
            }
            catch (err) {
                await retryRequest(err, 0);
                i -= 10;
                continue;
            }
        }
    }
}