import dotenv from 'dotenv';

import spotifyApi from './auth';
import { completedPlaylists, playlistIds, lastPlaylistTracks, shuffledMasterPlaylist, shuffledPlaylists } from './data'
import { waitForAccessToken, writeToDataFile, retryRequest, getPlaylistTracks, confirmAllPlaylistsWereAdded, createNewPlaylist, addTracksToLocalPlaylist, addTracksToSpotifyPlaylist, shuffleMasterPlaylist } from './utils';
dotenv.config();

async function main() {
	const tokenFetched = await waitForAccessToken();
	if (!tokenFetched) {
		console.log('Failed to fetch access token. Trying again in 1 second...')
		await new Promise((resolve) => setTimeout(resolve, 1000));
		main();
		return;
	}

	console.log('Getting all tracks from playlists...')
	const playlistTracks = await getPlaylistTracks(playlistIds);
	console.log('Got all tracks from playlists!')
	console.log('There are a total of', playlistTracks.length, 'tracks from all playlists')

	console.log('Confirming all playlists were added...')
	const playlistsWereAdded = await confirmAllPlaylistsWereAdded(playlistIds, completedPlaylists);
	let shuffledMasterPlaylist: string[] = [];
	if (playlistsWereAdded) {
		console.log('All playlists were added!')

		console.log('Shuffling tracks and adding to shuffled master playlist...')
		shuffledMasterPlaylist = await shuffleMasterPlaylist(playlistTracks);

		if (shuffledMasterPlaylist.length === 0) {
			console.error('No tracks were found. Exiting...')
			return;
		}
	}
	else {
		console.error('Not all playlists were added. Exiting...')
		return;
	}

	console.log('Finished!');
}

main();
